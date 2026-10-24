import WebSocket from "ws";
import type { SatellitePositionUpdate } from "./types.js";

export interface WebsocketAdapterOptions {
  name: string;
  url: string;
  /**
   * Built once per (re)connect and sent as the first frame — e.g.
   * aisstream.io's {APIKey, BoundingBoxes, ...} subscribe message. Returning
   * null sends nothing (for protocols that don't need an explicit subscribe).
   */
  buildSubscribeMessage: () => Record<string, unknown> | null;
  /** Turn one incoming JSON frame into zero or one normalized update. */
  parseMessage: (msg: unknown) => SatellitePositionUpdate | null;
  onError?: (message: string) => void;
  onOpen?: () => void;
}

export interface WebsocketAdapter {
  name: string;
  start(onUpdate: (update: SatellitePositionUpdate) => void): void;
  stop(): void;
}

/**
 * Generic long-lived WebSocket source: connects, sends a subscribe frame,
 * parses incoming JSON messages, and reconnects with backoff on drop —
 * the push-based counterpart to httpPollingAdapter's periodic GET.
 */
export function createWebsocketAdapter(options: WebsocketAdapterOptions): WebsocketAdapter {
  let socket: WebSocket | null = null;
  let stopped = false;
  let backoffMs = 1000;
  let onUpdateCb: ((update: SatellitePositionUpdate) => void) | null = null;

  function connect(): void {
    if (stopped) return;
    const ws = new WebSocket(options.url);
    socket = ws;

    ws.on("open", () => {
      backoffMs = 1000;
      options.onOpen?.();
      const subscribe = options.buildSubscribeMessage();
      if (subscribe) ws.send(JSON.stringify(subscribe));
    });

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        return; // not JSON — ignore rather than crash the connection
      }
      try {
        const update = options.parseMessage(parsed);
        if (update && onUpdateCb) onUpdateCb(update);
      } catch (err) {
        console.warn(`[ingest] ${options.name} failed to parse message: ${(err as Error).message}`);
      }
    });

    ws.on("error", (err) => {
      console.warn(`[ingest] ${options.name} websocket error: ${err.message}`);
      options.onError?.(err.message);
    });

    ws.on("close", (code, reason) => {
      if (stopped) return;
      const reasonText = reason?.toString("utf8");
      console.warn(
        `[ingest] ${options.name} websocket closed (code ${code}${reasonText ? `, ${reasonText}` : ""}), retrying in ${backoffMs}ms`
      );
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  }

  return {
    name: options.name,
    start(onUpdate) {
      onUpdateCb = onUpdate;
      connect();
    },
    stop() {
      stopped = true;
      socket?.close();
    },
  };
}
