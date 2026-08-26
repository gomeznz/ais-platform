import type { SatelliteAdapter, SatellitePositionUpdate } from "./types.js";

interface DemoVessel {
  mmsi: number;
  shipName: string;
  callSign: string;
  shipType: number;
  lat: number;
  lon: number;
  headingDeg: number;
  speedKn: number;
}

// A handful of MMSIs in the 900000000+ range, which real vessels never
// use, so this can never collide with genuine AIS traffic if this adapter
// is accidentally left enabled.
const DEMO_VESSELS: DemoVessel[] = [
  { mmsi: 900000001, shipName: "DEMO STAR", callSign: "DEMO1", shipType: 70, lat: -36.84, lon: 174.76, headingDeg: 45, speedKn: 12 },
  { mmsi: 900000002, shipName: "DEMO VOYAGER", callSign: "DEMO2", shipType: 80, lat: -41.29, lon: 174.78, headingDeg: 190, speedKn: 9 },
  { mmsi: 900000003, shipName: "DEMO HORIZON", callSign: "DEMO3", shipType: 30, lat: -37.02, lon: 174.9, headingDeg: 300, speedKn: 6 },
];

const NAUTICAL_MILES_PER_DEGREE_LAT = 60;

function stepVessel(v: DemoVessel, seconds: number): void {
  const distanceNm = (v.speedKn * seconds) / 3600;
  const rad = (v.headingDeg * Math.PI) / 180;
  const dLat = (distanceNm * Math.cos(rad)) / NAUTICAL_MILES_PER_DEGREE_LAT;
  const dLon =
    (distanceNm * Math.sin(rad)) / (NAUTICAL_MILES_PER_DEGREE_LAT * Math.cos((v.lat * Math.PI) / 180));
  v.lat += dLat;
  v.lon += dLon;
  // gentle random heading drift so tracks aren't perfectly straight lines
  v.headingDeg = (v.headingDeg + (Math.random() - 0.5) * 10 + 360) % 360;
}

/**
 * Synthetic "satellite feed" for local development and demos: a few vessels
 * that move along simple paths, emitted through the same SatelliteAdapter
 * interface a real provider integration would use. Enable with
 * MOCK_REPLAY=true when no real terrestrial or satellite feed is configured.
 */
export function createMockDemoAdapter(intervalMs: number): SatelliteAdapter {
  let timer: NodeJS.Timeout | null = null;
  const vessels = DEMO_VESSELS.map((v) => ({ ...v }));
  let staticSent = false;

  return {
    name: "mock-demo",
    start(onUpdate) {
      const tick = () => {
        const seconds = intervalMs / 1000;
        for (const v of vessels) {
          stepVessel(v, seconds);
          const update: SatellitePositionUpdate = {
            mmsi: v.mmsi,
            lat: v.lat,
            lon: v.lon,
            sog: v.speedKn,
            cog: v.headingDeg,
            heading: Math.round(v.headingDeg),
            navStatus: 0,
            timestamp: new Date().toISOString(),
            // Only send static fields once, like a real feed would (static
            // data doesn't repeat on every position report).
            shipName: staticSent ? undefined : v.shipName,
            callSign: staticSent ? undefined : v.callSign,
            shipType: staticSent ? undefined : v.shipType,
          };
          onUpdate(update);
        }
        staticSent = true;
      };
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
