import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { authenticate } from "../auth/plugin.js";
import { requireTenantAdmin, requirePlatformAdmin, resolveTenantId } from "../middleware/tenantScope.js";
import { hashPassword, generateTempPassword } from "../auth/password.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

interface CreateUserBody {
  email: string;
  role?: "owner" | "admin" | "member";
}

interface UpdateUserBody {
  role?: "owner" | "admin" | "member";
  status?: "active" | "disabled";
}

interface CreateTenantBody {
  name: string;
  ownerEmail: string;
}

/**
 * User management, scoped to a tenant. A tenant's own owner/admin manages
 * their own org (resolveTenantId falls back to their own tenantId); a
 * platform admin can manage any tenant by passing ?tenantId=<id>.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireTenantAdmin);

  app.get("/admin/users", async (request) => {
    const tenantId = resolveTenantId(request);
    const { rows } = await pool.query(
      `SELECT id, email, role, status, is_platform_admin, must_change_password, created_at
       FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
    return { users: rows };
  });

  app.post<{ Body: CreateUserBody }>("/admin/users", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { email, role } = request.body ?? ({} as CreateUserBody);
    if (!email) return reply.code(400).send({ error: "email is required" });
    const finalRole = role ?? "member";

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, email, role, status, created_at`,
        [tenantId, email.toLowerCase(), passwordHash, finalRole]
      );
      return reply.code(201).send({ user: rows[0], tempPassword });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "An account with that email already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateUserBody }>(
    "/admin/users/:id",
    async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const { rows: existingRows } = await pool.query(
        "SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2",
        [request.params.id, tenantId]
      );
      const existing = existingRows[0];
      if (!existing) return reply.code(404).send({ error: "User not found" });

      const { role, status } = request.body ?? {};
      const demotingOrDisabling =
        existing.role === "owner" && ((role && role !== "owner") || status === "disabled");
      if (demotingOrDisabling) {
        const { rows: ownerRows } = await pool.query(
          "SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'",
          [tenantId]
        );
        if (ownerRows[0].n <= 1) {
          return reply.code(400).send({ error: "Can't remove the last owner of an organization" });
        }
      }

      const { rows } = await pool.query(
        `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status)
         WHERE id = $1
         RETURNING id, email, role, status, created_at`,
        [request.params.id, role ?? null, status ?? null]
      );
      return { user: rows[0] };
    }
  );

  app.post<{ Params: { id: string } }>("/admin/users/:id/reset-password", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { rows: existingRows } = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
      [request.params.id, tenantId]
    );
    if (existingRows.length === 0) return reply.code(404).send({ error: "User not found" });

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    await pool.query(
      "UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1",
      [request.params.id, passwordHash]
    );
    return { ok: true, tempPassword };
  });

  app.delete<{ Params: { id: string } }>("/admin/users/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { rows: existingRows } = await pool.query(
      "SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2",
      [request.params.id, tenantId]
    );
    const existing = existingRows[0];
    if (!existing) return reply.code(404).send({ error: "User not found" });

    if (existing.role === "owner") {
      const { rows: ownerRows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND role = 'owner'",
        [tenantId]
      );
      if (ownerRows[0].n <= 1) {
        return reply.code(400).send({ error: "Can't remove the last owner of an organization" });
      }
    }

    await pool.query("DELETE FROM users WHERE id = $1", [request.params.id]);
    return reply.code(204).send();
  });
}

/** Platform-wide admin: cross-tenant visibility and tenant onboarding, for ASI staff only. */
export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePlatformAdmin);

  app.get("/platform/tenants", async () => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.slug, t.created_at,
              COUNT(DISTINCT u.id)::int AS user_count,
              COUNT(DISTINCT f.id)::int AS fleet_count,
              COUNT(DISTINCT r.id)::int AS receiver_count
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
       LEFT JOIN fleets f ON f.tenant_id = t.id
       LEFT JOIN receivers r ON r.tenant_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at ASC`
    );
    return { tenants: rows };
  });

  app.post<{ Body: CreateTenantBody }>("/platform/tenants", async (request, reply) => {
    const { name, ownerEmail } = request.body ?? ({} as CreateTenantBody);
    if (!name || !ownerEmail) {
      return reply.code(400).send({ error: "name and ownerEmail are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const baseSlug = slugify(name);
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { rows } = await client.query("SELECT 1 FROM tenants WHERE slug = $1", [slug]);
        if (rows.length === 0) break;
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }
      const tenantResult = await client.query(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
        [name, slug]
      );
      const tenantId = tenantResult.rows[0].id as string;

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      let userResult;
      try {
        userResult = await client.query(
          `INSERT INTO users (tenant_id, email, password_hash, role, must_change_password)
           VALUES ($1, $2, $3, 'owner', true) RETURNING id, email, role`,
          [tenantId, ownerEmail.toLowerCase(), passwordHash]
        );
      } catch (err) {
        await client.query("ROLLBACK");
        if ((err as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "An account with that email already exists" });
        }
        throw err;
      }
      await client.query("COMMIT");

      return reply.code(201).send({
        tenant: { id: tenantId, name, slug },
        owner: userResult.rows[0],
        tempPassword,
      });
    } finally {
      client.release();
    }
  });

  app.get("/platform/users", async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.is_platform_admin, u.must_change_password, u.created_at,
              t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       ORDER BY u.created_at ASC`
    );
    return { users: rows };
  });

  app.patch<{ Params: { id: string }; Body: { isPlatformAdmin: boolean } }>(
    "/platform/users/:id/platform-admin",
    async (request, reply) => {
      const { isPlatformAdmin } = request.body ?? ({} as { isPlatformAdmin: boolean });
      if (typeof isPlatformAdmin !== "boolean") {
        return reply.code(400).send({ error: "isPlatformAdmin (boolean) is required" });
      }
      const { rows } = await pool.query(
        "UPDATE users SET is_platform_admin = $2 WHERE id = $1 RETURNING id, email, is_platform_admin",
        [request.params.id, isPlatformAdmin]
      );
      if (rows.length === 0) return reply.code(404).send({ error: "User not found" });
      return { user: rows[0] };
    }
  );
}
