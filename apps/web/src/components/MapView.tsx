import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";

export interface MapVessel {
  mmsi: number;
  lat: number;
  lon: number;
  heading: number | null;
  cog: number | null;
  shipName: string | null;
  label: string | null;
  sog: number | null;
  fleetName: string;
  color: string;
}

interface MapViewProps {
  vessels: MapVessel[];
  onSelectVessel?: (mmsi: number) => void;
}

const SOURCE_ID = "vessels";
const LAYER_ID = "vessel-arrows";

function colorToIconId(color: string): string {
  return `vessel-arrow-${color.replace("#", "")}`;
}

/** Draws a small colored arrow (triangle) used as the per-fleet vessel icon. */
function createArrowImage(color: string, size = 28): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 5, size - 5);
  ctx.lineTo(size / 2, size * 0.68);
  ctx.lineTo(5, size - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function toFeatureCollection(vessels: MapVessel[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vessels.map((v) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      properties: {
        mmsi: v.mmsi,
        heading: v.heading ?? v.cog ?? 0,
        shipName: v.shipName,
        label: v.label,
        sog: v.sog,
        fleetName: v.fleetName,
        icon: colorToIconId(v.color),
      },
    })),
  };
}

export function MapView({ vessels, onSelectVessel }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedIconsRef = useRef<Set<string>>(new Set());
  const vesselsRef = useRef(vessels);
  vesselsRef.current = vessels;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [174.8, -39.5], // roughly central NZ; harmless default for any deployment
      zoom: 4,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toFeatureCollection(vesselsRef.current),
      });
      map.addLayer({
        id: LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": 0.9,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, offset: 14 });
      map.on("mouseenter", LAYER_ID, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(
            `<strong>${p.label || p.shipName || `MMSI ${p.mmsi}`}</strong><br/>` +
              `${p.fleetName}${p.sog != null ? ` · ${Number(p.sog).toFixed(1)} kn` : ""}`
          )
          .addTo(map);
      });
      map.on("mouseleave", LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (f && onSelectVessel) onSelectVessel(Number((f.properties as Record<string, unknown>).mmsi));
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new vessel data into the map whenever it changes, and lazily
  // register any fleet colors we haven't drawn an arrow icon for yet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyData = () => {
      for (const v of vessels) {
        const iconId = colorToIconId(v.color);
        if (!loadedIconsRef.current.has(iconId) && !map.hasImage(iconId)) {
          map.addImage(iconId, createArrowImage(v.color));
          loadedIconsRef.current.add(iconId);
        }
      }
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(toFeatureCollection(vessels));
    };

    if (map.isStyleLoaded() && map.getSource(SOURCE_ID)) {
      applyData();
    } else {
      map.once("load", applyData);
    }
  }, [vessels]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
