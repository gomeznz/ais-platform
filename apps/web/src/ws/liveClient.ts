import { API_BASE } from "../api/client.js";

export interface LivePositionUpdate {
  mmsi: number;
  ts: string;
  lon: number | null;
  lat: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
}

const WS_BASE = import.meta.env.VITE_WS_URL ?? API_BASE.replace(/^http/, "ws");

/**
 * Wraps the /ws/live endpoint: connects, re-subscribes to whatever fleets
 * were requested (including across reconnects), and hands parsed position
 * updates to the caller.
 */
export class LiveFeedClient {
  private socket: WebSocket | null = null;
  private fleetIds = new Set<string>();
  private onUpdate: (update: LivePositionUpdate) => void;
  private token: string;
  private stopped = false;
  private backoffMs = 1000;

  constructor(token: string, onUpdate: (update: LivePositionUpdate) => void) {
    this.token = token;
    this.onUpdate = onUpdate;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(`${WS_BASE}/ws/live?token=${encodeURIComponent(this.token)}`);
    this.socket = ws;

    ws.onopen = () => {
      this.backoffMs = 1000;
      for (const fleetId of this.fleetIds) this.sendSubscribe(fleetId);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "position") this.onUpdate(msg.data as LivePositionUpdate);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 15_000);
    };
  }

  private sendSubscribe(fleetId: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "subscribe", fleetId }));
    }
  }

  subscribeFleet(fleetId: string): void {
    this.fleetIds.add(fleetId);
    this.sendSubscribe(fleetId);
  }

  unsubscribeFleet(fleetId: string): void {
    this.fleetIds.delete(fleetId);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "unsubscribe", fleetId }));
    }
  }

  close(): void {
    this.stopped = true;
    this.socket?.close();
  }
}
