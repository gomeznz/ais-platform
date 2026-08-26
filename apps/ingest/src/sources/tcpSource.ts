import net from "node:net";
import { AisDecoder, type DecodedAisMessage } from "@ais-platform/ais-decoder";
import { LineFramer } from "./lineFramer.js";

type OnMessage = (msg: DecodedAisMessage, source: string) => void;

/**
 * Dial out to one or more terrestrial feeders that speak raw NMEA/AIVDM
 * over a persistent TCP connection (an AIS dispatcher like AISdeco/AIS
 * Dispatcher, a receiver's built-in TCP server, or a shore station relay).
 * Reconnects with backoff on drop.
 */
export function startTcpClientFeeds(feeds: string[], onMessage: OnMessage): () => void {
  const stopFns = feeds.map((feed) => startOneClientFeed(feed, onMessage));
  return () => stopFns.forEach((stop) => stop());
}

function startOneClientFeed(feed: string, onMessage: OnMessage): () => void {
  const [host, portStr] = feed.split(":");
  const port = Number(portStr);
  const sourceName = `terrestrial:tcp:${feed}`;
  let stopped = false;
  let socket: net.Socket | null = null;
  let backoffMs = 1000;

  const connect = () => {
    if (stopped) return;
    const decoder = new AisDecoder();
    const framer = new LineFramer((line) => {
      const msg = decoder.processLine(line);
      if (msg) onMessage(msg, sourceName);
    });

    socket = net.createConnection({ host, port }, () => {
      console.log(`[ingest] connected to terrestrial feed ${feed}`);
      backoffMs = 1000;
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => framer.push(chunk.toString("utf8")));
    socket.on("error", (err) => {
      console.warn(`[ingest] feed ${feed} error: ${err.message}`);
    });
    socket.on("close", () => {
      if (stopped) return;
      console.warn(`[ingest] feed ${feed} disconnected, retrying in ${backoffMs}ms`);
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  };

  connect();

  return () => {
    stopped = true;
    socket?.destroy();
  };
}

/**
 * Accept inbound TCP connections from receivers/dispatchers configured to
 * push their NMEA stream to us, rather than us dialing out.
 */
export function startTcpListener(port: number, onMessage: OnMessage): () => void {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const sourceName = `terrestrial:tcp-inbound:${remote}`;
    console.log(`[ingest] inbound feed connected from ${remote}`);
    const decoder = new AisDecoder();
    const framer = new LineFramer((line) => {
      const msg = decoder.processLine(line);
      if (msg) onMessage(msg, sourceName);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => framer.push(chunk.toString("utf8")));
    socket.on("error", (err) => console.warn(`[ingest] inbound ${remote} error: ${err.message}`));
    socket.on("close", () => console.log(`[ingest] inbound feed ${remote} disconnected`));
  });

  server.listen(port, () => console.log(`[ingest] listening for terrestrial feeds on tcp:${port}`));

  return () => server.close();
}
