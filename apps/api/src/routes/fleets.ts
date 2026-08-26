import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { authenticate } from "../auth/plugin.js";
import { findTenantFleet } from "../middleware/tenantScope.js";

interface CreateFleetBody {
  name: string;
  description?: string;
  color?: string;
}

interface AddVesselBody {
  mmsi: number;
  label?: string;
}

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/fleets", async (request) => {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.description, f.color, f.created_at,
              COUNT(fv.mmsi)::int AS vessel_count
       FROM fleets f
       LEFT JOIN fleet_vessels fv ON fv.fleet_id = f.id
       WHERE f.tenant_id = $1
       GROUP BY f.id
       ORDER BY f.created_at ASC`,
      [request.user!.tenantId]
    );
    return { fleets: rows };
  });

  app.post<{ Body: CreateFleetBody }>("/fleets", async (request, reply) => {
    const { name, description, color } = request.body ?? ({} as CreateFleetBody);
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const { rows } = await pool.query(
        `INSERT INTO fleets (tenant_id, name, description, color)
         VALUES ($1, $2, $3, COALESCE($4, '#2563eb'))
         RETURNING id, name, description, color, created_at`,
        [request.user!.tenantId, name, description ?? null, color ?? null]
      );
      return reply.code(201).send({ fleet: rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "A fleet with that name already exists" });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/fleets/:id", async (request, reply) => {
    const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
    if (!fleet) return reply.code(404).send({ error: "Fleet not found" });

    const { rows: vessels } = await pool.query(
      `SELECT v.mmsi, v.ship_name, v.call_sign, v.ship_type_text, fv.label, fv.added_at
       FROM fleet_vessels fv JOIN vessels v ON v.mmsi = fv.mmsi
       WHERE fv.fleet_id = $1
       ORDER BY fv.added_at ASC`,
      [fleet.id]
    );
    return { fleet, vessels };
  });

  app.patch<{ Params: { id: string }; Body: Partial<CreateFleetBody> }>(
    "/fleets/:id",
    async (request, reply) => {
      const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
      if (!fleet) return reply.code(404).send({ error: "Fleet not found" });

      const { name, description, color } = request.body ?? {};
      const { rows } = await pool.query(
        `UPDATE fleets SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           color = COALESCE($4, color)
         WHERE id = $1
         RETURNING id, name, description, color, created_at`,
        [fleet.id, name ?? null, description ?? null, color ?? null]
      );
      return { fleet: rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/fleets/:id", async (request, reply) => {
    const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
    if (!fleet) return reply.code(404).send({ error: "Fleet not found" });
    await pool.query("DELETE FROM fleets WHERE id = $1", [fleet.id]);
    return reply.code(204).send();
  });

  // --- Fleet membership -----------------------------------------------------

  app.post<{ Params: { id: string }; Body: AddVesselBody }>(
    "/fleets/:id/vessels",
    async (request, reply) => {
      const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
      if (!fleet) return reply.code(404).send({ error: "Fleet not found" });

      const { mmsi, label } = request.body ?? ({} as AddVesselBody);
      if (!mmsi || !Number.isInteger(mmsi)) {
        return reply.code(400).send({ error: "a numeric mmsi is required" });
      }

      // Vessel may not have broadcast static data yet — create a stub so
      // fleet membership can be recorded ahead of the first sighting.
      await pool.query("INSERT INTO vessels (mmsi) VALUES ($1) ON CONFLICT (mmsi) DO NOTHING", [
        mmsi,
      ]);
      await pool.query(
        `INSERT INTO fleet_vessels (fleet_id, mmsi, label) VALUES ($1, $2, $3)
         ON CONFLICT (fleet_id, mmsi) DO UPDATE SET label = EXCLUDED.label`,
        [fleet.id, mmsi, label ?? null]
      );
      return reply.code(201).send({ ok: true });
    }
  );

  app.delete<{ Params: { id: string; mmsi: string } }>(
    "/fleets/:id/vessels/:mmsi",
    async (request, reply) => {
      const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
      if (!fleet) return reply.code(404).send({ error: "Fleet not found" });
      await pool.query("DELETE FROM fleet_vessels WHERE fleet_id = $1 AND mmsi = $2", [
        fleet.id,
        Number(request.params.mmsi),
      ]);
      return reply.code(204).send();
    }
  );

  // --- Live positions for everything in a fleet ------------------------------

  app.get<{ Params: { id: string } }>("/fleets/:id/positions", async (request, reply) => {
    const fleet = await findTenantFleet(request.params.id, request.user!.tenantId);
    if (!fleet) return reply.code(404).send({ error: "Fleet not found" });

    const { rows } = await pool.query(
      `SELECT v.mmsi, v.ship_name, v.call_sign, v.ship_type_text, fv.label,
              cp.ts, cp.lon, cp.lat, cp.sog, cp.cog, cp.true_heading, cp.nav_status, cp.source
       FROM fleet_vessels fv
       JOIN vessels v ON v.mmsi = fv.mmsi
       LEFT JOIN current_positions cp ON cp.mmsi = fv.mmsi
       WHERE fv.fleet_id = $1`,
      [fleet.id]
    );
    return { positions: rows };
  });
}
