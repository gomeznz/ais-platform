/** Navigation status codes from ITU-R M.1371 (message types 1/2/3). */
export const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by her draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
  9: "reserved (HSC)",
  10: "reserved (WIG)",
  11: "power-driven vessel towing astern",
  12: "power-driven vessel pushing ahead/towing alongside",
  13: "reserved",
  14: "AIS-SART / MOB / EPIRB",
  15: "not defined",
};

export const SHIP_TYPE_CATEGORY: Array<[number, number, string]> = [
  [20, 29, "Wing in ground"],
  [30, 30, "Fishing"],
  [31, 32, "Towing"],
  [33, 33, "Dredging/underwater ops"],
  [34, 34, "Diving ops"],
  [35, 35, "Military ops"],
  [36, 36, "Sailing"],
  [37, 37, "Pleasure craft"],
  [40, 49, "High speed craft"],
  [50, 50, "Pilot vessel"],
  [51, 51, "Search and rescue vessel"],
  [52, 52, "Tug"],
  [53, 53, "Port tender"],
  [54, 54, "Anti-pollution equipment"],
  [55, 55, "Law enforcement"],
  [58, 58, "Medical transport"],
  [60, 69, "Passenger"],
  [70, 79, "Cargo"],
  [80, 89, "Tanker"],
  [90, 99, "Other"],
];

export function shipTypeCategory(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  for (const [lo, hi, label] of SHIP_TYPE_CATEGORY) {
    if (code >= lo && code <= hi) return label;
  }
  return "Not available";
}

/** Common fields present on every decoded AIS message. */
export interface AisMessageBase {
  type: number;
  repeat: number;
  mmsi: number;
  channel?: string;
  /** ISO timestamp when this station received/decoded the message. */
  receivedAt: string;
}

/** Message types 1, 2, 3 — Class A position report. */
export interface PositionReportClassA extends AisMessageBase {
  kind: "position_a";
  navStatus: number;
  navStatusText: string;
  rateOfTurn: number | null;
  speedOverGround: number | null;
  positionAccuracy: boolean;
  lon: number | null;
  lat: number | null;
  courseOverGround: number | null;
  trueHeading: number | null;
  timestampSecond: number;
  maneuverIndicator: number;
  raim: boolean;
}

/** Message type 4 — base station report. */
export interface BaseStationReport extends AisMessageBase {
  kind: "base_station";
  utc: string | null;
  lon: number | null;
  lat: number | null;
  positionAccuracy: boolean;
  epfdType: number;
}

/** Message type 5 — static and voyage related data. */
export interface StaticVoyageData extends AisMessageBase {
  kind: "static_voyage";
  imo: number;
  callSign: string;
  shipName: string;
  shipType: number;
  shipTypeText: string;
  dimToBow: number;
  dimToStern: number;
  dimToPort: number;
  dimToStarboard: number;
  epfdType: number;
  etaMonth: number;
  etaDay: number;
  etaHour: number;
  etaMinute: number;
  draught: number;
  destination: string;
}

/** Message types 18/19 — Class B position report (standard / extended). */
export interface PositionReportClassB extends AisMessageBase {
  kind: "position_b";
  speedOverGround: number | null;
  positionAccuracy: boolean;
  lon: number | null;
  lat: number | null;
  courseOverGround: number | null;
  trueHeading: number | null;
  timestampSecond: number;
  isExtended: boolean;
  shipName?: string;
  shipType?: number;
  shipTypeText?: string;
  dimToBow?: number;
  dimToStern?: number;
  dimToPort?: number;
  dimToStarboard?: number;
}

/** Message type 24 — static data report (Class B), part A or B. */
export interface StaticDataReportB extends AisMessageBase {
  kind: "static_data_b";
  partNumber: 0 | 1;
  shipName?: string;
  shipType?: number;
  shipTypeText?: string;
  callSign?: string;
  dimToBow?: number;
  dimToStern?: number;
  dimToPort?: number;
  dimToStarboard?: number;
}

export type DecodedAisMessage =
  | PositionReportClassA
  | BaseStationReport
  | StaticVoyageData
  | PositionReportClassB
  | StaticDataReportB;

/** Any position-bearing message, useful for the ingest pipeline. */
export function isPositionReport(
  msg: DecodedAisMessage
): msg is PositionReportClassA | PositionReportClassB {
  return msg.kind === "position_a" || msg.kind === "position_b";
}
