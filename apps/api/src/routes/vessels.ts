import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { authenticate } from "../auth/plugin.js";

interface HistoryQuery {
  from?: string;
  to?: string;
  limit?: string;
}

export async function vesselRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Vessel identity/position data is shared AIS infrastructure, not
  // tenant-owned (see db/migrations/001_init.sql), so any authenticated
  // user can look up any vessel by MMSI — same as any public AIS tracker.
  app.get<{ Params: { mmsi: string } }>("/vessels/:mmsi", async (request, reply) => {
    const mmsi = Number(request.params.mmsi);
    if (!Number.isInteger(mmsi)) return reply.code(400).send({ error: "invalid mmsi" });

    const { rows } = await pool.query(
      `SELECT v.*, cp.ts AS position_ts, cp.lon, cp.lat, cp.sog, cp.cog, cp.true_heading, cp.nav_status
       FROM vessels v LEFT JOIN current_positions cp ON cp.mmsi = v.mmsi
       WHERE v.mmsi = $1`,
      [mmsi]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Vessel not found" });
    return { vessel: rows[0] };
  });

  app.get<{ Params: { mmsi: string }; Querystring: HistoryQuery }>(
    "/vessels/:mmsi/history",
    async (request, reply) => {
      const mmsi = Number(request.params.mmsi);
      if (!Number.isInteger(mmsi)) return reply.code(400).send({ error: "invalid mmsi" });

      const { from, to, limit } = request.query;
      const cappedLimit = Math.min(Number(limit) || 1000, 10_000);

      const { rows } = await pool.query(
        `SELECT ts, lon, lat, sog, cog, true_heading, nav_status
         FROM positions
         WHERE mmsi = $1
           AND ($2::timestamptz IS NULL OR ts >= $2)
           AND ($3::timestamptz IS NULL OR ts <= $3)
         ORDER BY ts DESC
         LIMIT $4`,
        [mmsi, from ?? null, to ?? null, cappedLimit]
      );
      return { mmsi, track: rows.reverse() };
    }
  );
}
