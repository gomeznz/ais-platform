import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/client.js";

/**
 * Returns the fleet row if it exists AND belongs to this tenant, otherwise
 * null. Callers should respond 404 (not 403) on null, so tenants can't
 * learn that a fleet id exists in someone else's account.
 */
export async function findTenantFleet(
  fleetId: string,
  tenantId: string
): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query(
    "SELECT id, name FROM fleets WHERE id = $1 AND tenant_id = $2",
    [fleetId, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * preHandler: require the caller to be an owner/admin within their own
 * tenant, OR a platform admin (who manages every tenant). Attach to any
 * route under /admin.
 */
export async function requireTenantAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user!;
  if (user.isPlatformAdmin) return;
  if (user.role === "owner" || user.role === "admin") return;
  return reply.code(403).send({ error: "Admin or owner role required" });
}

/** preHandler: require the caller to be a platform admin. Attach to /platform routes. */
export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user!.isPlatformAdmin) {
    return reply.code(403).send({ error: "Platform admin required" });
  }
}

/**
 * Admin routes operate on the caller's own tenant by default. A platform
 * admin may instead pass ?tenantId=<id> to act on any tenant — this is
 * what lets the same /admin/* endpoints serve both a tenant's own
 * owner/admin and ASI's cross-tenant platform admin without duplicating
 * every route.
 */
export function resolveTenantId(request: FastifyRequest): string {
  const user = request.user!;
  const query = request.query as Record<string, string | undefined>;
  if (user.isPlatformAdmin && query?.tenantId) return query.tenantId;
  return user.tenantId;
}
