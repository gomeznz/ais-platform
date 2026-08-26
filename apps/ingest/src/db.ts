import pg from "pg";
import { config } from "./config.js";
import type { NormalizedPosition, NormalizedStaticUpdate } from "./model.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

// pg.Pool emits 'error' for backend errors on idle clients (e.g. the DB
// restarting) that aren't tied to any in-flight query. Without a listener,
// Node treats that as an unhandled EventEmitter error and crashes the
// process — so this listener's only job is to keep the process alive;
// the pool reconnects new clients on the next query automatically.
pool.on("error", (err) => {
  console.error("[ingest] postgres pool idle client error (will reconnect):", err.message);
});

/** Ensure a vessel row exists (stub if we've never seen static data for it). */
export async function ensureVesselStub(mmsi: number): Promise<void> {
  await pool.query(`INSERT INTO vessels (mmsi) VALUES ($1) ON CONFLICT (mmsi) DO NOTHING`, [
    mmsi,
  ]);
}

export async function upsertPosition(pos: NormalizedPosition, source: string): Promise<void> {
  if (pos.lat === null || pos.lon === null) return; // nothing useful to plot

  await ensureVesselStub(pos.mmsi);

  await pool.query(
    `INSERT INTO positions (mmsi, ts, lon, lat, sog, cog, true_heading, nav_status, position_accuracy, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (mmsi, ts) DO NOTHING`,
    [
      pos.mmsi,
      pos.ts,
      pos.lon,
      pos.lat,
      pos.sog,
      pos.cog,
      pos.heading,
      pos.navStatus,
      pos.positionAccuracy,
      source,
    ]
  );

  // Only advance current_positions (and notify) if this report isn't older
  // than what we already have, so out-of-order delivery never rewinds the
  // live map.
  const { rows } = await pool.query(
    `INSERT INTO current_positions (mmsi, ts, lon, lat, sog, cog, true_heading, nav_status, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (mmsi) DO UPDATE SET
       ts = EXCLUDED.ts, lon = EXCLUDED.lon, lat = EXCLUDED.lat, sog = EXCLUDED.sog,
       cog = EXCLUDED.cog, true_heading = EXCLUDED.true_heading, nav_status = EXCLUDED.nav_status,
       source = EXCLUDED.source, updated_at = now()
     WHERE current_positions.ts <= EXCLUDED.ts
     RETURNING mmsi`,
    [pos.mmsi, pos.ts, pos.lon, pos.lat, pos.sog, pos.cog, pos.heading, pos.navStatus, source]
  );

  if (rows.length > 0) {
    const payload = JSON.stringify({
      mmsi: pos.mmsi,
      ts: pos.ts,
      lon: pos.lon,
      lat: pos.lat,
      sog: pos.sog,
      cog: pos.cog,
      heading: pos.heading,
      navStatus: pos.navStatus,
    });
    // pg NOTIFY payloads are capped around 8000 bytes; a position update is
    // tiny, so this is always safe.
    await pool.query("SELECT pg_notify('position_update', $1)", [payload]);
  }
}

export async function upsertVesselStatic(update: NormalizedStaticUpdate): Promise<void> {
  await ensureVesselStub(update.mmsi);
  await pool.query(
    `UPDATE vessels SET
       imo = COALESCE($2, imo),
       ship_name = COALESCE($3, ship_name),
       call_sign = COALESCE($4, call_sign),
       ship_type = COALESCE($5, ship_type),
       ship_type_text = COALESCE($6, ship_type_text),
       dim_to_bow = COALESCE($7, dim_to_bow),
       dim_to_stern = COALESCE($8, dim_to_stern),
       dim_to_port = COALESCE($9, dim_to_port),
       dim_to_starboard = COALESCE($10, dim_to_starboard),
       destination = COALESCE($11, destination),
       draught = COALESCE($12, draught),
       eta_month = COALESCE($13, eta_month),
       eta_day = COALESCE($14, eta_day),
       eta_hour = COALESCE($15, eta_hour),
       eta_minute = COALESCE($16, eta_minute),
       last_static_update = now(),
       updated_at = now()
     WHERE mmsi = $1`,
    [
      update.mmsi,
      update.imo ?? null,
      update.shipName || null,
      update.callSign || null,
      update.shipType ?? null,
      update.shipTypeText ?? null,
      update.dimToBow ?? null,
      update.dimToStern ?? null,
      update.dimToPort ?? null,
      update.dimToStarboard ?? null,
      update.destination || null,
      update.draught ?? null,
      update.etaMonth ?? null,
      update.etaDay ?? null,
      update.etaHour ?? null,
      update.etaMinute ?? null,
    ]
  );
}
