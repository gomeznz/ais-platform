import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { authenticate } from "../auth/plugin.js";
import { requireTenantAdmin, resolveTenantId } from "../middleware/tenantScope.js";

type ReceiverKind = "tcp_client" | "http_polling";

interface TcpClientConfig {
  host: string;
  port: number;
}

interface HttpPollingConfig {
  url: string;
  token?: string;
  intervalMs?: number;
  /** "generic" (default) expects {vessels:[...]} or a bare array; "aistrail" parses aistrail.com's /v1/positions shape. */
  provider?: "generic" | "aistrail";
}

interface CreateReceiverBody {
  name: string;
  kind: ReceiverKind;
  config: TcpClientConfig | HttpPollingConfig;
  enabled?: boolean;
}

interface UpdateReceiverBody {
  name?: string;
  config?: TcpClientConfig | HttpPollingConfig;
  enabled?: boolean;
}

function validateConfig(kind: ReceiverKind, config: unknown): string | null {
  if (!config || typeof config !== "object") return "config is required";
  const c = config as Record<string, unknown>;
  if (kind === "tcp_client") {
    if (typeof c.host !== "string" || !c.host.trim()) return "config.host is required for tcp_client";
    if (typeof c.port !== "number" || !Number.isInteger(c.port) || c.port <= 0 || c.port > 65535) {
      return "config.port must be a valid port number for tcp_client";
    }
    return null;
  }
  if (kind === "http_polling") {
    if (typeof c.url !== "string" || !c.url.trim()) return "config.url is required for http_polling";
    try {
      new URL(c.url);
    } catch {
      return "config.url must be a valid URL";
    }
    if (c.intervalMs !== undefined && (typeof c.intervalMs !== "number" || c.intervalMs < 1000)) {
      return "config.intervalMs must be at least 1000ms";
    }
    if (c.provider !== undefined && c.provider !== "generic" && c.provider !== "aistrail") {
      return "config.provider must be generic or aistrail";
    }
    return null;
  }
  return "kind must be tcp_client or http_polling";
}

async function notifyReceiversChanged(tenantId: string): Promise<void> {
  await pool.query("SELECT pg_notify('receivers_changed', $1)", [tenantId]);
}

/**
 * AIS receiver connections, scoped to a tenant the same way /admin/users is:
 * a tenant's own owner/admin manages their own receivers, a platform admin
 * can manage any tenant's via ?tenantId=<id>. The ingest service picks up
 * changes within a few seconds (poll + NOTIFY), no redeploy needed.
 */
export async function receiverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireTenantAdmin);

  app.get("/admin/receivers", async (request) => {
    const tenantId = resolveTenantId(request);
    const { rows } = await pool.query(
      `SELECT id, name, kind, config, enabled, status, status_message, last_message_at, created_at, updated_at
       FROM receivers WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
    return { receivers: rows };
  });

  app.post<{ Body: CreateReceiverBody }>("/admin/receivers", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { name, kind, config, enabled } = request.body ?? ({} as CreateReceiverBody);
    if (!name) return reply.code(400).send({ error: "name is required" });
    const configError = validateConfig(kind, config);
    if (configError) return reply.code(400).send({ error: configError });

    try {
      const { rows } = await pool.query(
        `INSERT INTO receivers (tenant_id, name, kind, config, enabled)
         VALUES ($1, $2, $3, $4, COALESCE($5, true))
         RETURNING id, name, kind, config, enabled, status, status_message, last_message_at, created_at, updated_at`,
        [tenantId, name, kind, JSON.stringify(config), enabled ?? null]
      );
      await notifyReceiversChanged(tenantId);
      return reply.code(201).send({ receiver: rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "A receiver with that name already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateReceiverBody }>(
    "/admin/receivers/:id",
    async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const { rows: existingRows } = await pool.query(
        "SELECT id, kind FROM receivers WHERE id = $1 AND tenant_id = $2",
        [request.params.id, tenantId]
      );
      const existing = existingRows[0];
      if (!existing) return reply.code(404).send({ error: "Receiver not found" });

      const { name, config, enabled } = request.body ?? {};
      if (config !== undefined) {
        const configError = validateConfig(existing.kind, config);
        if (configError) return reply.code(400).send({ error: configError });
      }

      const { rows } = await pool.query(
        `UPDATE receivers SET
           name = COALESCE($2, name),
           config = COALESCE($3, config),
           enabled = COALESCE($4, enabled),
           updated_at = now()
         WHERE id = $1
         RETURNING id, name, kind, config, enabled, status, status_message, last_message_at, created_at, updated_at`,
        [request.params.id, name ?? null, config ? JSON.stringify(config) : null, enabled ?? null]
      );
      await notifyReceiversChanged(tenantId);
      return { receiver: rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/receivers/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { rows } = await pool.query(
      "DELETE FROM receivers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [request.params.id, tenantId]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Receiver not found" });
    await notifyReceiversChanged(tenantId);
    return reply.code(204).send();
  });
}
