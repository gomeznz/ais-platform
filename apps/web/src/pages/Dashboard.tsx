import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Fleet, type FleetVessel } from "../api/client.js";
import { useAuth } from "../state/auth.js";
import { LiveFeedClient, type LivePositionUpdate } from "../ws/liveClient.js";
import { FleetSidebar } from "../components/FleetSidebar.js";
import { MapView, type MapVessel } from "../components/MapView.js";

export function Dashboard() {
  const { token, tenant, user, logout } = useAuth();
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [vesselsByFleet, setVesselsByFleet] = useState<Record<string, FleetVessel[]>>({});
  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<Map<number, LivePositionUpdate>>(new Map());
  const liveClientRef = useRef<LiveFeedClient | null>(null);

  const loadFleetPositions = useCallback(
    async (fleetId: string) => {
      if (!token) return;
      const { positions } = await api.fleetPositions(token, fleetId);
      setVesselsByFleet((prev) => ({ ...prev, [fleetId]: positions }));
    },
    [token]
  );

  const refreshFleets = useCallback(async () => {
    if (!token) return;
    const { fleets: loaded } = await api.listFleets(token);
    setFleets(loaded);
    for (const fleet of loaded) {
      await loadFleetPositions(fleet.id);
      liveClientRef.current?.subscribeFleet(fleet.id);
    }
  }, [token, loadFleetPositions]);

  // Initial load + live feed connection.
  useEffect(() => {
    if (!token) return;
    liveClientRef.current = new LiveFeedClient(token, (update) => {
      setLivePositions((prev) => {
        const next = new Map(prev);
        next.set(update.mmsi, update);
        return next;
      });
    });
    refreshFleets();
    return () => {
      liveClientRef.current?.close();
      liveClientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedFleetId && fleets.length > 0) setSelectedFleetId(fleets[0].id);
  }, [fleets, selectedFleetId]);

  const handleCreateFleet = useCallback(
    async (name: string) => {
      if (!token) return;
      const { fleet } = await api.createFleet(token, name);
      setFleets((prev) => [...prev, fleet]);
      setSelectedFleetId(fleet.id);
      liveClientRef.current?.subscribeFleet(fleet.id);
    },
    [token]
  );

  const handleDeleteFleet = useCallback(
    async (fleetId: string) => {
      if (!token) return;
      await api.deleteFleet(token, fleetId);
      liveClientRef.current?.unsubscribeFleet(fleetId);
      setFleets((prev) => prev.filter((f) => f.id !== fleetId));
      setVesselsByFleet((prev) => {
        const { [fleetId]: _removed, ...rest } = prev;
        return rest;
      });
      setSelectedFleetId((prev) => (prev === fleetId ? null : prev));
    },
    [token]
  );

  const handleAddVessel = useCallback(
    async (mmsi: number, label: string) => {
      if (!token || !selectedFleetId) return;
      await api.addVesselToFleet(token, selectedFleetId, mmsi, label || undefined);
      await loadFleetPositions(selectedFleetId);
      liveClientRef.current?.subscribeFleet(selectedFleetId);
      setFleets((prev) =>
        prev.map((f) => (f.id === selectedFleetId ? { ...f, vessel_count: (f.vessel_count ?? 0) + 1 } : f))
      );
    },
    [token, selectedFleetId, loadFleetPositions]
  );

  const handleRemoveVessel = useCallback(
    async (mmsi: number) => {
      if (!token || !selectedFleetId) return;
      await api.removeVesselFromFleet(token, selectedFleetId, mmsi);
      await loadFleetPositions(selectedFleetId);
      setFleets((prev) =>
        prev.map((f) =>
          f.id === selectedFleetId ? { ...f, vessel_count: Math.max((f.vessel_count ?? 1) - 1, 0) } : f
        )
      );
    },
    [token, selectedFleetId, loadFleetPositions]
  );

  const mapVessels: MapVessel[] = useMemo(() => {
    const seen = new Set<number>();
    const out: MapVessel[] = [];
    for (const fleet of fleets) {
      for (const v of vesselsByFleet[fleet.id] ?? []) {
        if (seen.has(v.mmsi)) continue; // vessel already shown under another fleet
        const live = livePositions.get(v.mmsi);
        const lat = live?.lat ?? v.lat;
        const lon = live?.lon ?? v.lon;
        if (lat == null || lon == null) continue;
        seen.add(v.mmsi);
        out.push({
          mmsi: v.mmsi,
          lat,
          lon,
          heading: live?.heading ?? v.true_heading,
          cog: live?.cog ?? v.cog,
          shipName: v.ship_name,
          label: v.label,
          sog: live?.sog ?? v.sog,
          fleetName: fleet.name,
          color: fleet.color,
        });
      }
    }
    return out;
  }, [fleets, vesselsByFleet, livePositions]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <strong>{tenant?.name}</strong> <span className="muted">— AIS Fleet Platform</span>
        </div>
        <div>
          <span className="muted">{user?.email}</span>
          <button className="link-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="dashboard-body">
        <FleetSidebar
          fleets={fleets}
          selectedFleetId={selectedFleetId}
          vessels={(selectedFleetId && vesselsByFleet[selectedFleetId]) || []}
          onSelectFleet={setSelectedFleetId}
          onCreateFleet={handleCreateFleet}
          onDeleteFleet={handleDeleteFleet}
          onAddVessel={handleAddVessel}
          onRemoveVessel={handleRemoveVessel}
        />
        <div className="map-container">
          <MapView vessels={mapVessels} />
        </div>
      </div>
    </div>
  );
}
