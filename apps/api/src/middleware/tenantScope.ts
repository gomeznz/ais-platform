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
