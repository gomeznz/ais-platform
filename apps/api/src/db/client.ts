import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

// See the matching comment in apps/ingest/src/db.ts: without this listener,
// an idle-client backend error (e.g. the DB restarting) crashes the process.
pool.on("error", (err) => {
  console.error("[api] postgres pool idle client error (will reconnect):", err.message);
});
