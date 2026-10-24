import type { SatellitePositionUpdate } from "./types.js";

export type HttpProvider = "generic" | "aistrail";

export const HTTP_PROVIDERS: HttpProvider[] = ["generic", "aistrail"];

function isHttpProvider(value: unknown): value is HttpProvider {
  return value === "generic" || value === "aistrail";
}

export function normalizeProvider(value: unknown): HttpProvider {
  return isHttpProvider(value) ? value : "generic";
}

/**
 * AIS Trail (https://aistrail.com) live positions endpoint: GET /v1/positions
 * (bbox) or GET /v1/vessels/{mmsi}/position. Auth is `Authorization: Bearer
 * ap_live_...`, already handled by httpPollingAdapter's generic `token`
 * option — this just has to turn their response shape into ours.
 *
 * Response shape (per https://aistrail.com/docs/quickstart/):
 *   { count, truncated, positions: [{ mmsi, ts, lat, lon, sog, cog, heading,
 *     nav_status, source, flags, name?, imo?, ship_type?, destination?,
 *     eta?, age_s, received_at }], meta }
 */
interface AisTrailPosition {
  mmsi: number;
  ts: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  nav_status?: number | null;
  name?: string | null;
  imo?: number | null;
  ship_type?: string | null; // text category (e.g. "Cargo"), not a numeric AIS code
  destination?: string | null;
  eta?: string | null; // ISO 8601, no year (AIS ETA has no year either)
}

interface AisTrailResponse {
  positions?: AisTrailPosition[];
}

/** Splits an ISO-ish ETA string into the month/day/hour/minute fields AIS (and our schema) uses. */
function splitEta(eta: string | null | undefined): {
  etaMonth: number | null;
  etaDay: number | null;
  etaHour: number | null;
  etaMinute: number | null;
} {
  if (!eta) return { etaMonth: null, etaDay: null, etaHour: null, etaMinute: null };
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return { etaMonth: null, etaDay: null, etaHour: null, etaMinute: null };
  return {
    etaMonth: d.getUTCMonth() + 1,
    etaDay: d.getUTCDate(),
    etaHour: d.getUTCHours(),
    etaMinute: d.getUTCMinutes(),
  };
}

function parseAisTrail(body: unknown): SatellitePositionUpdate[] {
  const positions = (body as AisTrailResponse)?.positions ?? [];
  const out: SatellitePositionUpdate[] = [];
  for (const p of positions) {
    if (typeof p.mmsi !== "number" || typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    out.push({
      mmsi: p.mmsi,
      lat: p.lat,
      lon: p.lon,
      sog: p.sog ?? null,
      cog: p.cog ?? null,
      heading: p.heading ?? null,
      navStatus: p.nav_status ?? null,
      timestamp: p.ts ?? new Date().toISOString(),
      shipName: p.name ?? null,
      imo: p.imo ?? null,
      shipTypeText: p.ship_type ?? null, // AIS Trail gives a category string, not a raw AIS code
      destination: p.destination ?? null,
      ...splitEta(p.eta),
    });
  }
  return out;
}

/** Returns a parseResponse override for the given provider, or undefined to use httpPollingAdapter's generic default. */
export function getProviderParser(
  provider: HttpProvider
): ((body: unknown) => SatellitePositionUpdate[]) | undefined {
  if (provider === "aistrail") return parseAisTrail;
  return undefined;
}
