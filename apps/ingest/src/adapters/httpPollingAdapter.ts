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
  /** Called with a human-readable message whenever a poll fails (non-2xx or network error). */
  onError?: (message: string) => void;
  /** Called on every successful (2xx) poll, even if it returned zero updates. */
  onPollOk?: () => void;
}

/**
 * RFC 9457 "problem details" error body, used by AIS Trail and a growing
 * number of JSON APIs. Not every provider uses this shape, so parsing it is
 * best-effort — a plain-text or differently-shaped error body just falls
 * back to the raw status line.
 */
interface ProblemDetails {
  title?: string;
  detail?: string;
  retry_after_s?: number;
}

async function describeHttpError(res: Response): Promise<string> {
  const base = `HTTP ${res.status}`;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return base;
  try {
    const body = (await res.json()) as ProblemDetails;
    const parts = [base, body.title, body.detail].filter(Boolean);
    if (body.retry_after_s) parts.push(`(retry after ${body.retry_after_s}s)`);
    return parts.join(" — ");
  } catch {
    return base;
  }
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
        const message = await describeHttpError(res);
        console.warn(`[ingest] ${options.name} poll failed: ${message}`);
        options.onError?.(message);
        return;
      }
      const body = await res.json();
      for (const update of parse(body)) onUpdate(update);
      options.onPollOk?.();
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`[ingest] ${options.name} poll error: ${message}`);
      options.onError?.(message);
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
