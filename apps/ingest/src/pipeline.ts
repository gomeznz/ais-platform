import { shipTypeCategory, type DecodedAisMessage } from "@ais-platform/ais-decoder";
import { upsertPosition, upsertVesselStatic } from "./db.js";
import type { NormalizedPosition, NormalizedStaticUpdate } from "./model.js";
import type { SatellitePositionUpdate } from "./adapters/types.js";

/** Route one normalized update from a satellite/aggregator adapter. */
export async function handleSatelliteUpdate(
  update: SatellitePositionUpdate,
  source: string
): Promise<void> {
  const pos: NormalizedPosition = {
    mmsi: update.mmsi,
    ts: update.timestamp,
    lon: update.lon,
    lat: update.lat,
    sog: update.sog ?? null,
    cog: update.cog ?? null,
    heading: update.heading ?? null,
    navStatus: update.navStatus ?? null,
    positionAccuracy: null,
  };
  await upsertPosition(pos, source);

  if (update.shipName || update.callSign || update.imo || update.shipType) {
    await upsertVesselStatic({
      mmsi: update.mmsi,
      shipName: update.shipName,
      callSign: update.callSign,
      imo: update.imo,
      shipType: update.shipType,
      shipTypeText: shipTypeCategory(update.shipType ?? undefined),
    });
  }
}

/** Route one decoded terrestrial AIS message to the right DB write. */
export async function handleDecodedMessage(
  msg: DecodedAisMessage,
  source: string
): Promise<void> {
  switch (msg.kind) {
    case "position_a":
    case "position_b": {
      const pos: NormalizedPosition = {
        mmsi: msg.mmsi,
        ts: msg.receivedAt,
        lon: msg.lon,
        lat: msg.lat,
        sog: msg.speedOverGround,
        cog: msg.courseOverGround,
        heading: msg.trueHeading,
        navStatus: msg.kind === "position_a" ? msg.navStatus : null,
        positionAccuracy: msg.positionAccuracy,
      };
      await upsertPosition(pos, source);

      // Class B extended reports (type 19) also carry static fields inline.
      if (msg.kind === "position_b" && msg.isExtended) {
        await upsertVesselStatic({
          mmsi: msg.mmsi,
          shipName: msg.shipName,
          shipType: msg.shipType,
          shipTypeText: msg.shipTypeText,
          dimToBow: msg.dimToBow,
          dimToStern: msg.dimToStern,
          dimToPort: msg.dimToPort,
          dimToStarboard: msg.dimToStarboard,
        });
      }
      break;
    }

    case "static_voyage": {
      const update: NormalizedStaticUpdate = {
        mmsi: msg.mmsi,
        imo: msg.imo,
        shipName: msg.shipName,
        callSign: msg.callSign,
        shipType: msg.shipType,
        shipTypeText: msg.shipTypeText,
        dimToBow: msg.dimToBow,
        dimToStern: msg.dimToStern,
        dimToPort: msg.dimToPort,
        dimToStarboard: msg.dimToStarboard,
        destination: msg.destination,
        draught: msg.draught,
        etaMonth: msg.etaMonth,
        etaDay: msg.etaDay,
        etaHour: msg.etaHour,
        etaMinute: msg.etaMinute,
      };
      await upsertVesselStatic(update);
      break;
    }

    case "static_data_b": {
      const update: NormalizedStaticUpdate =
        msg.partNumber === 0
          ? { mmsi: msg.mmsi, shipName: msg.shipName }
          : {
              mmsi: msg.mmsi,
              callSign: msg.callSign,
              shipType: msg.shipType,
              shipTypeText: msg.shipTypeText,
              dimToBow: msg.dimToBow,
              dimToStern: msg.dimToStern,
              dimToPort: msg.dimToPort,
              dimToStarboard: msg.dimToStarboard,
            };
      await upsertVesselStatic(update);
      break;
    }

    case "base_station":
      break; // not vessel data; nothing to persist for fleet tracking v1
  }
}
