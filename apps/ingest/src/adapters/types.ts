/**
 * Satellite/aggregator providers (Spire, MarineTraffic, exactEarth, AISHub,
 * etc) typically hand you already-decoded JSON rather than raw NMEA. An
 * adapter's job is just to normalize whatever shape a given provider uses
 * into this common update, then call back into the pipeline — no AIS
 * bit-decoding involved on this path.
 */
export interface SatellitePositionUpdate {
  mmsi: number;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  navStatus?: number | null;
  timestamp: string; // ISO 8601
  shipName?: string | null;
  callSign?: string | null;
  imo?: number | null;
  shipType?: number | null;
}

export interface SatelliteAdapter {
  name: string;
  start(onUpdate: (update: SatellitePositionUpdate) => void): void;
  stop(): void;
}
