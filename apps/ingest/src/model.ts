/**
 * Common shape both ingest paths (decoded terrestrial NMEA, and
 * already-decoded satellite/aggregator JSON) normalize into before
 * hitting the database. This is what keeps the two source types
 * interchangeable from the pipeline's point of view.
 */
export interface NormalizedPosition {
  mmsi: number;
  ts: string; // ISO timestamp
  lon: number | null;
  lat: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  positionAccuracy: boolean | null;
}

export interface NormalizedStaticUpdate {
  mmsi: number;
  imo?: number | null;
  shipName?: string | null;
  callSign?: string | null;
  shipType?: number | null;
  shipTypeText?: string | null;
  dimToBow?: number | null;
  dimToStern?: number | null;
  dimToPort?: number | null;
  dimToStarboard?: number | null;
  destination?: string | null;
  draught?: number | null;
  etaMonth?: number | null;
  etaDay?: number | null;
  etaHour?: number | null;
  etaMinute?: number | null;
}
