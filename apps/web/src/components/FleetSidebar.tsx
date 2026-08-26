import { useState, type FormEvent } from "react";
import type { Fleet, FleetVessel } from "../api/client.js";

interface FleetSidebarProps {
  fleets: Fleet[];
  selectedFleetId: string | null;
  vessels: FleetVessel[];
  onSelectFleet: (fleetId: string) => void;
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (fleetId: string) => Promise<void>;
  onAddVessel: (mmsi: number, label: string) => Promise<void>;
  onRemoveVessel: (mmsi: number) => Promise<void>;
}

export function FleetSidebar({
  fleets,
  selectedFleetId,
  vessels,
  onSelectFleet,
  onCreateFleet,
  onDeleteFleet,
  onAddVessel,
  onRemoveVessel,
}: FleetSidebarProps) {
  const [newFleetName, setNewFleetName] = useState("");
  const [newMmsi, setNewMmsi] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFleet = fleets.find((f) => f.id === selectedFleetId) ?? null;

  async function handleCreateFleet(e: FormEvent) {
    e.preventDefault();
    if (!newFleetName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateFleet(newFleetName.trim());
      setNewFleetName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddVessel(e: FormEvent) {
    e.preventDefault();
    const mmsi = Number(newMmsi);
    if (!Number.isInteger(mmsi) || !selectedFleetId) return;
    setBusy(true);
    setError(null);
    try {
      await onAddVessel(mmsi, newLabel.trim());
      setNewMmsi("");
      setNewLabel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <h2>Fleets</h2>
        <ul className="fleet-list">
          {fleets.map((fleet) => (
            <li key={fleet.id} className={fleet.id === selectedFleetId ? "active" : ""}>
              <button className="fleet-list-item" onClick={() => onSelectFleet(fleet.id)}>
                <span className="fleet-color-dot" style={{ background: fleet.color }} />
                <span className="fleet-name">{fleet.name}</span>
                <span className="fleet-count">{fleet.vessel_count ?? 0}</span>
              </button>
            </li>
          ))}
          {fleets.length === 0 && <li className="empty-hint">No fleets yet — create one below.</li>}
        </ul>
        <form className="inline-form" onSubmit={handleCreateFleet}>
          <input
            placeholder="New fleet name"
            value={newFleetName}
            onChange={(e) => setNewFleetName(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            Add
          </button>
        </form>
      </div>

      {selectedFleet && (
        <div className="sidebar-section">
          <div className="section-header">
            <h2>{selectedFleet.name}</h2>
            <button className="link-button danger" onClick={() => onDeleteFleet(selectedFleet.id)}>
              Delete fleet
            </button>
          </div>

          <ul className="vessel-list">
            {vessels.map((v) => (
              <li key={v.mmsi}>
                <div>
                  <div className="vessel-name">{v.label || v.ship_name || `MMSI ${v.mmsi}`}</div>
                  <div className="vessel-meta">
                    {v.ship_type_text || "Unknown type"} · {v.mmsi}
                    {v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ""}
                  </div>
                </div>
                <button className="link-button" onClick={() => onRemoveVessel(v.mmsi)}>
                  Remove
                </button>
              </li>
            ))}
            {vessels.length === 0 && <li className="empty-hint">No vessels in this fleet yet.</li>}
          </ul>

          <form className="inline-form" onSubmit={handleAddVessel}>
            <input
              placeholder="MMSI"
              inputMode="numeric"
              value={newMmsi}
              onChange={(e) => setNewMmsi(e.target.value)}
            />
            <input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              Add vessel
            </button>
          </form>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
