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
    let messageCount = 0;

    ws.on("open", () => {
      backoffMs = 1000;
      options.onOpen?.();
      const subscribe = options.buildSubscribeMessage();
      if (subscribe) {
        // Log what was actually sent (minus any API key) — cheap way to
        // confirm the subscribe payload matches what the admin UI saved,
        // without needing DB access to check.
        const redacted = Object.fromEntries(
          Object.entries(subscribe).map(([k, v]) => [k, /api[-_]?key/i.test(k) ? "<redacted>" : v])
        );
        console.log(`[ingest] ${options.name} connected, sending subscribe: ${JSON.stringify(redacted)}`);
        ws.send(JSON.stringify(subscribe));
      }
    });

    ws.on("message", (raw) => {
      messageCount += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        console.warn(`[ingest] ${options.name} received non-JSON message (${raw.toString().length} bytes)`);
        return;
      }
      try {
        const update = options.parseMessage(parsed);
        // Log liberally at first (traffic has been zero so far — every frame
        // is diagnostic signal) and fall back to sampling once it's clear
        // messages really are flowing, so this can't turn into log spam.
        if (messageCount <= 20 || messageCount % 50 === 0) {
          const type = (parsed as { MessageType?: string } | null)?.MessageType ?? "(no MessageType)";
          console.log(
            `[ingest] ${options.name} msg#${messageCount} type="${type}" -> ${
              update ? `parsed OK (mmsi ${update.mmsi})` : "dropped (not a usable position — see raw below)"
            }`
          );
          if (!update) {
            console.log(`[ingest] ${options.name} msg#${messageCount} raw: ${JSON.stringify(parsed).slice(0, 500)}`);
          }
        }
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
