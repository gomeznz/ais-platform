import { buildApp } from "./app.js";
import { config } from "./config.js";
import { positionListener } from "./ws/pgListener.js";
import { pool } from "./db/client.js";

async function main() {
  await pool.query("SELECT 1"); // fail fast if the DB isn't reachable
  await positionListener.start();

  const app = await buildApp();
  await app.listen({ port: config.port, host: "0.0.0.0" });

  const shutdown = async () => {
    await app.close();
    await positionListener.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[api] fatal startup error", err);
  process.exit(1);
});
