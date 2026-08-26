import type { SatelliteAdapter, SatellitePositionUpdate } from "./types.js";

export interface HttpPollingAdapterOptions {
  name: string;
  url: string;
  /** Sent as `Authorization: Bearer <token>` if provided. */
  token?: string;
  intervalMs: number;
  /**
   * Turn one HTTP response body into normalized updates. Defaults to
   * expecting `{ vessels: [{ mmsi, lat, lon, sog, cog, heading, timestamp, ... }] }`
   * or a bare array of the same shape — override this per real provider,
   * since every satellite/aggregator API has its own schema.
   */
  parseResponse?: (body: unknown) => SatellitePositionUpdate[];
}

function defaultParse(body: unknown): SatellitePositionUpdate[] {
  const list = Array.isArray(body) ? body : (body as { vessels?: unknown[] })?.vessels ?? [];
  const out: SatellitePositionUpdate[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (typeof item.mmsi !== "number" || typeof item.lat !== "number" || typeof item.lon !== "number") {
      continue;
    }
    out.push({
      mmsi: item.mmsi,
      lat: item.lat,
      lon: item.lon,
      sog: typeof item.sog === "number" ? item.sog : null,
      cog: typeof item.cog === "number" ? item.cog : null,
      heading: typeof item.heading === "number" ? item.heading : null,
      navStatus: typeof item.navStatus === "number" ? item.navStatus : null,
      timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
      shipName: typeof item.shipName === "string" ? item.shipName : null,
      callSign: typeof item.callSign === "string" ? item.callSign : null,
      imo: typeof item.imo === "number" ? item.imo : null,
      shipType: typeof item.shipType === "number" ? item.shipType : null,
    });
  }
  return out;
}

/**
 * Generic REST polling adapter: fetch a URL on an interval, parse the body
 * into normalized position updates. Works for any satellite/aggregator API
 * that exposes "current vessel positions" as JSON over HTTP — plug in a
 * `parseResponse` for the specific provider's schema.
 */
export function createHttpPollingAdapter(options: HttpPollingAdapterOptions): SatelliteAdapter {
  let timer: NodeJS.Timeout | null = null;
  const parse = options.parseResponse ?? defaultParse;

  async function poll(onUpdate: (u: SatellitePositionUpdate) => void) {
    try {
      const res = await fetch(options.url, {
        headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
      });
      if (!res.ok) {
        console.warn(`[ingest] ${options.name} poll failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json();
      for (const update of parse(body)) onUpdate(update);
    } catch (err) {
      console.warn(`[ingest] ${options.name} poll error: ${(err as Error).message}`);
    }
  }

  return {
    name: options.name,
    start(onUpdate) {
      poll(onUpdate);
      timer = setInterval(() => poll(onUpdate), options.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
