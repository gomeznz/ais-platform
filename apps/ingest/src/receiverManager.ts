import net from "node:net";
import pg from "pg";
import { AisDecoder, type DecodedAisMessage } from "@ais-platform/ais-decoder";
import { LineFramer } from "./sources/lineFramer.js";
import { createHttpPollingAdapter } from "./adapters/httpPollingAdapter.js";
import { getProviderParser, normalizeProvider } from "./adapters/providers.js";
import { createWebsocketAdapter } from "./adapters/websocketAdapter.js";
import { AISSTREAM_DEFAULT_URL, buildAisStreamSubscribeMessage, parseAisStreamMessage } from "./adapters/aisstreamProvider.js";
import type { SatellitePositionUpdate } from "./adapters/types.js";
import { config } from "./config.js";
import {
  fetchActiveReceivers,
  updateReceiverStatus,
  touchReceiverLastMessage,
  recordReceiverEvent,
  type ReceiverRow,
} from "./db.js";

const { Client } = pg;

type OnMessage = (msg: DecodedAisMessage, source: string) => void;
type OnSatelliteUpdate = (update: SatellitePositionUpdate, source: string) => void;

const TOUCH_THROTTLE_MS = 5_000;

interface RunningReceiver {
  configHash: string;
  stop: () => void;
}

/**
 * Dynamically starts/stops AIS receiver connections (tcp_client dial-out,
 * http_polling) based on the `receivers` table, so adding/editing/removing
 * one from the admin UI takes effect without redeploying this service.
 *
 * Picks up changes via LISTEN/NOTIFY on "receivers_changed" (near-instant)
 * with a periodic poll as a safety net in case a notification is missed
 * (e.g. this process restarted mid-change).
 */
export class ReceiverManager {
  private running = new Map<string, RunningReceiver>();
  private lastTouch = new Map<string, number>();
  private listenClient: pg.Client | null = null;
  private stopped = false;
  private backoffMs = 2000;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private onMessage: OnMessage,
    private onSatelliteUpdate: OnSatelliteUpdate
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), 20_000);
    await this.connectListener();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.listenClient?.end();
    for (const r of this.running.values()) r.stop();
    this.running.clear();
  }

  private async connectListener(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: config.databaseUrl });
    this.listenClient = client;

    client.on("notification", (msg) => {
      if (msg.channel !== "receivers_changed") return;
      this.refresh().catch((err) =>
        console.warn("[ingest] receiver refresh after notify failed:", (err as Error).message)
      );
    });
    client.on("error", (err) => console.warn("[ingest] receiver listener connection error", err.message));
    client.on("end", () => {
      if (this.stopped) return;
      console.warn("[ingest] receiver listener disconnected, reconnecting");
      this.scheduleReconnect();
    });

    await client.connect();
    await client.query("LISTEN receivers_changed");
    this.backoffMs = 2000;
    console.log("[ingest] listening for receivers_changed notifications");
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      this.connectListener().catch((err) => {
        console.warn(`[ingest] receiver listener reconnect failed: ${err.message}`);
        this.scheduleReconnect();
      });
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 1.5, 30_000);
  }

  private async refresh(): Promise<void> {
    let receivers: ReceiverRow[];
    try {
      receivers = await fetchActiveReceivers();
    } catch (err) {
      console.warn("[ingest] failed to fetch receivers:", (err as Error).message);
      return;
    }

    const desired = new Map(receivers.map((r) => [r.id, r]));

    // Stop anything removed or disabled.
    for (const [id, running] of this.running) {
      if (!desired.has(id)) {
        running.stop();
        this.running.delete(id);
      }
    }

    // Start new receivers, and restart any whose config changed.
    for (const receiver of receivers) {
      const configHash = JSON.stringify(receiver.config);
      const existing = this.running.get(receiver.id);
      if (existing && existing.configHash === configHash) continue;
      if (existing) {
        existing.stop();
        this.running.delete(receiver.id);
      }
      const stop = this.startReceiver(receiver);
      this.running.set(receiver.id, { configHash, stop });
    }
  }

  private touch(id: string): void {
    const now = Date.now();
    const last = this.lastTouch.get(id) ?? 0;
    if (now - last < TOUCH_THROTTLE_MS) return;
    this.lastTouch.set(id, now);
    touchReceiverLastMessage(id).catch(() => {});
  }

  private startReceiver(receiver: ReceiverRow): () => void {
    const sourceName = `tenant:${receiver.tenant_slug}:receiver:${receiver.name}`;
    if (receiver.kind === "tcp_client") {
      return this.startTcpClientReceiver(receiver, sourceName);
    }
    if (receiver.kind === "websocket") {
      return this.startWebsocketReceiver(receiver, sourceName);
    }
    return this.startHttpPollingReceiver(receiver, sourceName);
  }

  private startTcpClientReceiver(receiver: ReceiverRow, sourceName: string): () => void {
    const host = String(receiver.config.host);
    const port = Number(receiver.config.port);
    let stopped = false;
    let socket: net.Socket | null = null;
    let backoffMs = 1000;

    const setStatus = (status: "connecting" | "connected" | "error", message?: string) => {
      updateReceiverStatus(receiver.id, status, message ?? null).catch(() => {});
    };

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const decoder = new AisDecoder();
      const framer = new LineFramer((line) => {
        const msg = decoder.processLine(line);
        if (msg) {
          this.touch(receiver.id);
          this.onMessage(msg, sourceName);
        }
      });

      socket = net.createConnection({ host, port }, () => {
        console.log(`[ingest] connected to receiver ${sourceName} (${host}:${port})`);
        backoffMs = 1000;
        setStatus("connected");
      });
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => framer.push(chunk.toString("utf8")));
      socket.on("error", (err) => {
        console.warn(`[ingest] receiver ${sourceName} error: ${err.message}`);
        setStatus("error", err.message);
      });
      socket.on("close", () => {
        if (stopped) return;
        console.warn(`[ingest] receiver ${sourceName} disconnected, retrying in ${backoffMs}ms`);
        setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      });
    };

    connect();

    return () => {
      stopped = true;
      socket?.destroy();
      updateReceiverStatus(receiver.id, "disabled", null).catch(() => {});
    };
  }

  private startHttpPollingReceiver(receiver: ReceiverRow, sourceName: string): () => void {
    const url = String(receiver.config.url);
    const token = typeof receiver.config.token === "string" ? receiver.config.token : undefined;
    const intervalMs = typeof receiver.config.intervalMs === "number" ? receiver.config.intervalMs : 15_000;
    const provider = normalizeProvider(receiver.config.provider);

    updateReceiverStatus(receiver.id, "connecting").catch(() => {});

    const adapter = createHttpPollingAdapter({
      name: sourceName,
      url,
      token,
      intervalMs,
      parseResponse: getProviderParser(provider),
      onError: (message) => updateReceiverStatus(receiver.id, "error", message).catch(() => {}),
      onPollOk: () => updateReceiverStatus(receiver.id, "connected").catch(() => {}),
    });

    adapter.start((update) => {
      this.touch(receiver.id);
      this.onSatelliteUpdate(update, sourceName);
    });

    return () => {
      adapter.stop();
      updateReceiverStatus(receiver.id, "disabled", null).catch(() => {});
    };
  }

  private startWebsocketReceiver(receiver: ReceiverRow, sourceName: string): () => void {
    const apiKey = String(receiver.config.apiKey ?? "");
    const boundingBoxes = Array.isArray(receiver.config.boundingBoxes)
      ? (receiver.config.boundingBoxes as [[number, number], [number, number]][])
      : [];
    const mmsiFilter = Array.isArray(receiver.config.mmsiFilter)
      ? (receiver.config.mmsiFilter as string[])
      : undefined;
    const messageTypes = Array.isArray(receiver.config.messageTypes)
      ? (receiver.config.messageTypes as string[])
      : undefined;
    const url = typeof receiver.config.url === "string" && receiver.config.url ? receiver.config.url : AISSTREAM_DEFAULT_URL;

    // A local/fast WebSocket can open and call onOpen before the initial
    // "connecting" write even resolves — chain status writes through one
    // promise so they always apply in the order they were issued, rather
    // than racing (two independent fire-and-forget queries can resolve out
    // of order and leave a stale "connecting" status behind).
    let statusChain = updateReceiverStatus(receiver.id, "connecting").catch(() => {});
    const setStatus = (status: "connected" | "error", message?: string | null) => {
      statusChain = statusChain
        .then(() => updateReceiverStatus(receiver.id, status, message ?? null))
        .catch(() => {});
    };

    const adapter = createWebsocketAdapter({
      name: sourceName,
      url,
      buildSubscribeMessage: () => buildAisStreamSubscribeMessage({ apiKey, boundingBoxes, mmsiFilter, messageTypes }),
      parseMessage: parseAisStreamMessage,
      onOpen: () => setStatus("connected"),
      onError: (message) => setStatus("error", message),
      onEvent: (event) => recordReceiverEvent(receiver.id, event).catch(() => {}),
    });

    adapter.start((update) => {
      this.touch(receiver.id);
      this.onSatelliteUpdate(update, sourceName);
    });

    return () => {
      adapter.stop();
      statusChain = statusChain.then(() => updateReceiverStatus(receiver.id, "disabled", null)).catch(() => {});
    };
  }
}
