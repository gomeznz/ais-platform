import { payloadToBitString, BitReader } from "./bits.js";
import { FragmentBuffer } from "./fragmentBuffer.js";
import { decodeMessageBody } from "./messages.js";
import { parseNmeaSentence } from "./nmea.js";
import type { DecodedAisMessage } from "./types.js";

export interface AisDecoderOptions {
  /** Drop sentences that fail NMEA checksum validation (default true). */
  requireValidChecksum?: boolean;
  /** How long to hold incomplete multi-fragment groups before discarding, ms. */
  fragmentTtlMs?: number;
}

/**
 * Stateful decoder for a single feed/connection. Multi-part sentences
 * (types 5, 19, 24) are buffered internally until all fragments arrive, so
 * feed each raw line from one source into the same instance in order.
 * Use a separate instance per physical connection/receiver.
 */
export class AisDecoder {
  private fragments: FragmentBuffer;
  private requireValidChecksum: boolean;

  constructor(options: AisDecoderOptions = {}) {
    this.fragments = new FragmentBuffer(options.fragmentTtlMs ?? 10_000);
    this.requireValidChecksum = options.requireValidChecksum ?? true;
  }

  /**
   * Process one raw line of text from a feed. Returns a decoded message if
   * this line completed one, or null if the line was noise, invalid,
   * unsupported, or an incomplete fragment awaiting its siblings.
   */
  processLine(line: string): DecodedAisMessage | null {
    const sentence = parseNmeaSentence(line);
    if (!sentence) return null;
    if (this.requireValidChecksum && !sentence.checksumOk) return null;

    const combined = this.fragments.add(sentence);
    if (!combined) return null;

    let bitString: string;
    try {
      bitString = payloadToBitString(combined.payload, combined.fillBits);
    } catch {
      return null; // corrupt payload character
    }
    if (bitString.length < 38) return null; // too short to even have an MMSI

    const reader = new BitReader(bitString);
    try {
      return decodeMessageBody(reader, sentence.channel ?? undefined, new Date().toISOString());
    } catch {
      return null;
    }
  }

  /** Number of incomplete multi-fragment groups currently buffered. */
  get pendingFragmentCount(): number {
    return this.fragments.pendingCount;
  }
}
