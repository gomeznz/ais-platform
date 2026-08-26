import pg from "pg";
import { config } from "../config.js";

const { Client } = pg;

export type PositionNotification = {
  mmsi: number;
  ts: string;
  lon: number | null;
  lat: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
};

/**
 * A dedicated (non-pooled) connection that LISTENs for position_update
 * notifications the ingest service emits via pg_notify, and fans them out
 * to local subscriber callbacks. One process-wide instance; reconnects on
 * drop so a transient DB blip doesn't permanently kill the live feed.
 *
 * Scaling note: this fan-out is in-process, so it works as-is for a single
 * API instance. Running multiple API replicas behind a load balancer would
 * need this replaced with a shared bus (e.g. Redis pub/sub) so a
 * notification reaches whichever replica holds the relevant WebSocket.
 */
export class PositionListener {
  private client: pg.Client | null = null;
  private subscribers = new Set<(update: PositionNotification) => void>();
  private stopped = false;
  private backoffMs = 2000;

  async start(): Promise<void> {
    await this.connect();
  }

  /** Retry connect() with backoff, catching failures so they can never
   * become an unhandled rejection (which would crash the whole process). */
  private scheduleReconnect(): void {
    setTimeout(() => {
      this.connect().catch((err) => {
        console.warn(`[api] pg listener reconnect attempt failed: ${err.message}`);
        this.scheduleReconnect();
      });
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 1.5, 30_000);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: config.databaseUrl });
    this.client = client;

    client.on("notification", (msg) => {
      if (msg.channel !== "position_update" || !msg.payload) return;
      try {
        const update = JSON.parse(msg.payload) as PositionNotification;
        for (const cb of this.subscribers) cb(update);
      } catch (err) {
        console.warn("[api] failed to parse position_update payload", err);
      }
    });

    client.on("error", (err) => {
      console.warn("[api] pg listener connection error", err.message);
    });

    client.on("end", () => {
      if (this.stopped) return;
      console.warn("[api] pg listener disconnected, reconnecting");
      this.scheduleReconnect();
    });

    await client.connect();
    await client.query("LISTEN position_update");
    this.backoffMs = 2000; // reset now that we're healthy again
    console.log("[api] listening for position_update notifications");
  }

  subscribe(cb: (update: PositionNotification) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.client?.end();
  }
}

export const positionListener = new PositionListener();
