import type { SatellitePositionUpdate } from "./types.js";

export const AISSTREAM_DEFAULT_URL = "wss://stream.aisstream.io/v0/stream";
export const AISSTREAM_DEFAULT_MESSAGE_TYPES = ["PositionReport", "StandardClassBPositionReport"];

export interface AisStreamConfig {
  apiKey: string;
  /** Each box is [[lat1,lon1],[lat2,lon2]] — aisstream.io's own bounding-box shape. */
  boundingBoxes: [[number, number], [number, number]][];
  mmsiFilter?: string[];
  messageTypes?: string[];
}

export function buildAisStreamSubscribeMessage(config: AisStreamConfig): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    APIKey: config.apiKey,
    BoundingBoxes: config.boundingBoxes,
    FilterMessageTypes: config.messageTypes ?? AISSTREAM_DEFAULT_MESSAGE_TYPES,
  };
  if (config.mmsiFilter && config.mmsiFilter.length > 0) {
    msg.FiltersShipMMSI = config.mmsiFilter;
  }
  return msg;
}

/**
 * aisstream.io sends {MessageType, MetaData, Message} frames. The docs are
 * inconsistent about whether Latitude/Longitude live under MetaData or
 * under Message.<Type> — this reads either, preferring MetaData since
 * that's what their own sample response shows.
 */
interface AisStreamFrame {
  MessageType?: string;
  MetaData?: {
    MMSI?: number;
    ShipName?: string;
    Latitude?: number;
    Longitude?: number;
    time_utc?: string;
  };
  Message?: Record<string, Record<string, unknown>>;
}

const POSITION_MESSAGE_TYPES = new Set([
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
]);

export function parseAisStreamMessage(raw: unknown): SatellitePositionUpdate | null {
  const frame = raw as AisStreamFrame;
  if (!frame?.MessageType || !POSITION_MESSAGE_TYPES.has(frame.MessageType)) return null;

  const body = frame.Message?.[frame.MessageType] ?? {};
  const meta = frame.MetaData ?? {};

  const mmsi = meta.MMSI ?? (body.UserID as number | undefined);
  const lat = meta.Latitude ?? (body.Latitude as number | undefined);
  const lon = meta.Longitude ?? (body.Longitude as number | undefined);
  if (typeof mmsi !== "number" || typeof lat !== "number" || typeof lon !== "number") return null;

  return {
    mmsi,
    lat,
    lon,
    sog: typeof body.Sog === "number" ? body.Sog : null,
    cog: typeof body.Cog === "number" ? body.Cog : null,
    heading: typeof body.TrueHeading === "number" ? body.TrueHeading : null,
    navStatus: typeof body.NavigationalStatus === "number" ? body.NavigationalStatus : null,
    timestamp: meta.time_utc ?? new Date().toISOString(),
    shipName: meta.ShipName ?? null,
  };
}
