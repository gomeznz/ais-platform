import { BitReader } from "./bits.js";
import {
  NAV_STATUS,
  shipTypeCategory,
  type BaseStationReport,
  type DecodedAisMessage,
  type PositionReportClassA,
  type PositionReportClassB,
  type StaticDataReportB,
  type StaticVoyageData,
} from "./types.js";

/** AIS lon/lat are fixed-point in 1/10000 minute; 181/91 = "not available". */
function decodeCoord(raw: number, divisor: number, notAvailable: number): number | null {
  if (raw === notAvailable) return null;
  return raw / divisor;
}

function decodeMessageBody(
  bits: BitReader,
  channel: string | undefined,
  receivedAt: string
): DecodedAisMessage | null {
  const type = bits.uint(0, 6);
  const repeat = bits.uint(6, 2);
  const mmsi = bits.uintBig(8, 30);

  switch (type) {
    case 1:
    case 2:
    case 3: {
      const navStatus = bits.uint(38, 4);
      const rotRaw = bits.int(42, 8);
      const sogRaw = bits.uint(50, 10);
      const positionAccuracy = bits.bool(60);
      const lonRaw = bits.int(61, 28);
      const latRaw = bits.int(89, 27);
      const cogRaw = bits.uint(116, 12);
      const headingRaw = bits.uint(128, 9);
      const timestampSecond = bits.uint(137, 6);
      const maneuverIndicator = bits.uint(143, 2);
      const raim = bits.bool(148);

      const msg: PositionReportClassA = {
        kind: "position_a",
        type,
        repeat,
        mmsi,
        channel,
        receivedAt,
        navStatus,
        navStatusText: NAV_STATUS[navStatus] ?? "unknown",
        rateOfTurn: rotRaw === -128 ? null : rotRaw,
        speedOverGround: sogRaw === 1023 ? null : sogRaw / 10,
        positionAccuracy,
        lon: decodeCoord(lonRaw, 600000, 181 * 600000),
        lat: decodeCoord(latRaw, 600000, 91 * 600000),
        courseOverGround: cogRaw === 3600 ? null : cogRaw / 10,
        trueHeading: headingRaw === 511 ? null : headingRaw,
        timestampSecond,
        maneuverIndicator,
        raim,
      };
      return msg;
    }

    case 4: {
      const year = bits.uint(38, 14);
      const month = bits.uint(52, 4);
      const day = bits.uint(56, 5);
      const hour = bits.uint(61, 5);
      const minute = bits.uint(66, 6);
      const second = bits.uint(72, 6);
      const positionAccuracy = bits.bool(78);
      const lonRaw = bits.int(79, 28);
      const latRaw = bits.int(107, 27);
      const epfdType = bits.uint(134, 4);

      let utc: string | null = null;
      if (year > 0) {
        try {
          utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
        } catch {
          utc = null;
        }
      }

      const msg: BaseStationReport = {
        kind: "base_station",
        type,
        repeat,
        mmsi,
        channel,
        receivedAt,
        utc,
        lon: decodeCoord(lonRaw, 600000, 181 * 600000),
        lat: decodeCoord(latRaw, 600000, 91 * 600000),
        positionAccuracy,
        epfdType,
      };
      return msg;
    }

    case 5: {
      const imo = bits.uintBig(40, 30);
      const callSign = bits.text(70, 42);
      const shipName = bits.text(112, 120);
      const shipType = bits.uint(232, 8);
      const dimToBow = bits.uint(240, 9);
      const dimToStern = bits.uint(249, 9);
      const dimToPort = bits.uint(258, 6);
      const dimToStarboard = bits.uint(264, 6);
      const epfdType = bits.uint(270, 4);
      const etaMonth = bits.uint(274, 4);
      const etaDay = bits.uint(278, 5);
      const etaHour = bits.uint(283, 5);
      const etaMinute = bits.uint(288, 6);
      const draughtRaw = bits.uint(294, 8);
      const destination = bits.text(302, 120);

      const msg: StaticVoyageData = {
        kind: "static_voyage",
        type,
        repeat,
        mmsi,
        channel,
        receivedAt,
        imo,
        callSign,
        shipName,
        shipType,
        shipTypeText: shipTypeCategory(shipType) ?? "unknown",
        dimToBow,
        dimToStern,
        dimToPort,
        dimToStarboard,
        epfdType,
        etaMonth,
        etaDay,
        etaHour,
        etaMinute,
        draught: draughtRaw / 10,
        destination,
      };
      return msg;
    }

    case 18: {
      const sogRaw = bits.uint(46, 10);
      const positionAccuracy = bits.bool(56);
      const lonRaw = bits.int(57, 28);
      const latRaw = bits.int(85, 27);
      const cogRaw = bits.uint(112, 12);
      const headingRaw = bits.uint(124, 9);
      const timestampSecond = bits.uint(133, 6);

      const msg: PositionReportClassB = {
        kind: "position_b",
        type,
        repeat,
        mmsi,
        channel,
        receivedAt,
        speedOverGround: sogRaw === 1023 ? null : sogRaw / 10,
        positionAccuracy,
        lon: decodeCoord(lonRaw, 600000, 181 * 600000),
        lat: decodeCoord(latRaw, 600000, 91 * 600000),
        courseOverGround: cogRaw === 3600 ? null : cogRaw / 10,
        trueHeading: headingRaw === 511 ? null : headingRaw,
        timestampSecond,
        isExtended: false,
      };
      return msg;
    }

    case 19: {
      const sogRaw = bits.uint(46, 10);
      const positionAccuracy = bits.bool(56);
      const lonRaw = bits.int(57, 28);
      const latRaw = bits.int(85, 27);
      const cogRaw = bits.uint(112, 12);
      const headingRaw = bits.uint(124, 9);
      const timestampSecond = bits.uint(133, 6);
      const shipName = bits.text(143, 120);
      const shipType = bits.uint(263, 8);
      const dimToBow = bits.uint(271, 9);
      const dimToStern = bits.uint(280, 9);
      const dimToPort = bits.uint(289, 6);
      const dimToStarboard = bits.uint(295, 6);

      const msg: PositionReportClassB = {
        kind: "position_b",
        type,
        repeat,
        mmsi,
        channel,
        receivedAt,
        speedOverGround: sogRaw === 1023 ? null : sogRaw / 10,
        positionAccuracy,
        lon: decodeCoord(lonRaw, 600000, 181 * 600000),
        lat: decodeCoord(latRaw, 600000, 91 * 600000),
        courseOverGround: cogRaw === 3600 ? null : cogRaw / 10,
        trueHeading: headingRaw === 511 ? null : headingRaw,
        timestampSecond,
        isExtended: true,
        shipName,
        shipType,
        shipTypeText: shipTypeCategory(shipType) ?? "unknown",
        dimToBow,
        dimToStern,
        dimToPort,
        dimToStarboard,
      };
      return msg;
    }

    case 24: {
      const partNumber = bits.uint(38, 2) as 0 | 1;
      if (partNumber === 0) {
        const shipName = bits.text(40, 120);
        const msg: StaticDataReportB = {
          kind: "static_data_b",
          type,
          repeat,
          mmsi,
          channel,
          receivedAt,
          partNumber,
          shipName,
        };
        return msg;
      } else {
        const shipType = bits.uint(40, 8);
        const callSign = bits.text(90, 42);
        const dimToBow = bits.uint(132, 9);
        const dimToStern = bits.uint(141, 9);
        const dimToPort = bits.uint(150, 6);
        const dimToStarboard = bits.uint(156, 6);
        const msg: StaticDataReportB = {
          kind: "static_data_b",
          type,
          repeat,
          mmsi,
          channel,
          receivedAt,
          partNumber,
          shipType,
          shipTypeText: shipTypeCategory(shipType) ?? "unknown",
          callSign,
          dimToBow,
          dimToStern,
          dimToPort,
          dimToStarboard,
        };
        return msg;
      }
    }

    default:
      return null; // message type not decoded (out of scope for fleet tracking v1)
  }
}

export { decodeMessageBody };
