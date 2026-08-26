import "dotenv/config";

function csv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ais",

  // Terrestrial: dial out to one or more feeders that speak raw NMEA over TCP
  // (e.g. an AIS dispatcher, rtl-ais, or a hardware receiver's network port).
  // Format: host:port,host2:port2
  tcpFeeds: csv("TCP_FEEDS"),

  // Terrestrial: accept inbound TCP connections from receivers that push
  // NMEA to us instead of us dialing them.
  tcpListenPort: process.env.TCP_LISTEN_PORT ? Number(process.env.TCP_LISTEN_PORT) : undefined,

  // Terrestrial/aggregator: listen for UDP datagrams carrying NMEA lines
  // (common for LAN receivers and some aggregator relays).
  udpListenPort: process.env.UDP_LISTEN_PORT ? Number(process.env.UDP_LISTEN_PORT) : undefined,

  // Satellite/aggregator: generic HTTP polling adapter for providers that
  // return already-decoded JSON positions (Spire, MarineTraffic, exactEarth,
  // AISHub's JSON API, etc). See adapters/httpPollingAdapter.ts.
  satelliteHttpUrl: process.env.SATELLITE_HTTP_URL,
  satelliteHttpToken: process.env.SATELLITE_HTTP_TOKEN,
  satellitePollIntervalMs: process.env.SATELLITE_POLL_INTERVAL_MS
    ? Number(process.env.SATELLITE_POLL_INTERVAL_MS)
    : 15_000,

  // Local dev / demo: replay a fixture NMEA log with jittered positions so
  // the live map has something to show when no real feed is configured.
  mockReplay: process.env.MOCK_REPLAY === "true",
  mockReplayIntervalMs: process.env.MOCK_REPLAY_INTERVAL_MS
    ? Number(process.env.MOCK_REPLAY_INTERVAL_MS)
    : 3_000,
};
