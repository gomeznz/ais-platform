import { config } from "./config.js";
import { pool } from "./db.js";
import { handleDecodedMessage, handleSatelliteUpdate } from "./pipeline.js";
import { startTcpClientFeeds, startTcpListener } from "./sources/tcpSource.js";
import { startUdpListener } from "./sources/udpSource.js";
import { createHttpPollingAdapter } from "./adapters/httpPollingAdapter.js";
import { createMockDemoAdapter } from "./adapters/mockDemoAdapter.js";
import type { SatelliteAdapter } from "./adapters/types.js";

async function main() {
  console.log("[ingest] starting AIS ingest service");
  await pool.query("SELECT 1"); // fail fast if the DB isn't reachable

  const stopFns: Array<() => void> = [];
  let anySourceConfigured = false;

  // --- Terrestrial sources -------------------------------------------------
  if (config.tcpFeeds.length > 0) {
    anySourceConfigured = true;
    stopFns.push(startTcpClientFeeds(config.tcpFeeds, (msg, source) => {
      handleDecodedMessage(msg, source).catch((err) =>
        console.error("[ingest] failed to persist message", err)
      );
    }));
  }

  if (config.tcpListenPort) {
    anySourceConfigured = true;
    stopFns.push(
      startTcpListener(config.tcpListenPort, (msg, source) => {
        handleDecodedMessage(msg, source).catch((err) =>
          console.error("[ingest] failed to persist message", err)
        );
      })
    );
  }

  if (config.udpListenPort) {
    anySourceConfigured = true;
    stopFns.push(
      startUdpListener(config.udpListenPort, (msg, source) => {
        handleDecodedMessage(msg, source).catch((err) =>
          console.error("[ingest] failed to persist message", err)
        );
      })
    );
  }

  // --- Satellite / aggregator sources --------------------------------------
  const satelliteAdapters: SatelliteAdapter[] = [];

  if (config.satelliteHttpUrl) {
    anySourceConfigured = true;
    satelliteAdapters.push(
      createHttpPollingAdapter({
        name: "satellite-http",
        url: config.satelliteHttpUrl,
        token: config.satelliteHttpToken,
        intervalMs: config.satellitePollIntervalMs,
      })
    );
  }

  if (config.mockReplay || !anySourceConfigured) {
    if (!anySourceConfigured) {
      console.log("[ingest] no real feeds configured — starting demo data so the map isn't empty");
    }
    satelliteAdapters.push(createMockDemoAdapter(config.mockReplayIntervalMs));
  }

  for (const adapter of satelliteAdapters) {
    adapter.start((update) => {
      handleSatelliteUpdate(update, `satellite:${adapter.name}`).catch((err) =>
        console.error("[ingest] failed to persist satellite update", err)
      );
    });
    stopFns.push(() => adapter.stop());
  }

  const shutdown = async () => {
    console.log("[ingest] shutting down");
    stopFns.forEach((stop) => stop());
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[ingest] fatal startup error", err);
  process.exit(1);
});
