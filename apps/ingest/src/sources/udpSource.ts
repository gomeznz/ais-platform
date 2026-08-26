import dgram from "node:dgram";
import { AisDecoder, type DecodedAisMessage } from "@ais-platform/ais-decoder";

type OnMessage = (msg: DecodedAisMessage, source: string) => void;

/**
 * Listen for AIVDM sentences delivered as UDP datagrams — common for LAN
 * receivers and some aggregator relays (e.g. AISHub-style feeds). Each
 * remote peer gets its own decoder instance so multi-part message
 * reassembly (types 5/19/24) doesn't mix fragments from different sources.
 */
export function startUdpListener(port: number, onMessage: OnMessage): () => void {
  const decodersByPeer = new Map<string, AisDecoder>();
  const socket = dgram.createSocket("udp4");

  socket.on("message", (msg, rinfo) => {
    const peerKey = `${rinfo.address}:${rinfo.port}`;
    let decoder = decodersByPeer.get(peerKey);
    if (!decoder) {
      decoder = new AisDecoder();
      decodersByPeer.set(peerKey, decoder);
    }
    const sourceName = `terrestrial:udp:${peerKey}`;
    const text = msg.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const decoded = decoder.processLine(line);
      if (decoded) onMessage(decoded, sourceName);
    }
  });

  socket.on("error", (err) => console.warn(`[ingest] udp listener error: ${err.message}`));
  socket.bind(port, () => console.log(`[ingest] listening for terrestrial feeds on udp:${port}`));

  return () => socket.close();
}
