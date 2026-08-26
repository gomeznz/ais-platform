import type { NmeaAisSentence } from "./nmea.js";

interface PendingGroup {
  fragments: (string | undefined)[];
  fragCount: number;
  channel: string | null;
  fillBits: number;
  firstSeenAt: number;
}

/**
 * Reassembles multi-fragment AIVDM sentences (types 5, 19, 24 commonly span
 * 2 sentences) into a single payload. Single-fragment sentences pass
 * through immediately. Incomplete groups are garbage-collected after
 * `maxAgeMs` so a lost fragment doesn't leak memory forever.
 */
export class FragmentBuffer {
  private groups = new Map<string, PendingGroup>();
  private maxAgeMs: number;

  constructor(maxAgeMs = 10_000) {
    this.maxAgeMs = maxAgeMs;
  }

  /**
   * Feed one parsed sentence. Returns the combined payload + fill bits once
   * all fragments of its group have arrived, or null if still waiting on
   * more fragments (or the sentence was otherwise unusable).
   */
  add(sentence: NmeaAisSentence): { payload: string; fillBits: number } | null {
    if (sentence.fragCount <= 1) {
      return { payload: sentence.payload, fillBits: sentence.fillBits };
    }

    const key = `${sentence.seqId ?? "_"}:${sentence.channel ?? "_"}:${sentence.fragCount}`;
    let group = this.groups.get(key);
    if (!group) {
      group = {
        fragments: new Array(sentence.fragCount).fill(undefined),
        fragCount: sentence.fragCount,
        channel: sentence.channel,
        fillBits: 0,
        firstSeenAt: Date.now(),
      };
      this.groups.set(key, group);
    }

    const idx = sentence.fragNumber - 1;
    if (idx < 0 || idx >= group.fragments.length) return null;
    group.fragments[idx] = sentence.payload;
    if (sentence.fragNumber === sentence.fragCount) {
      group.fillBits = sentence.fillBits;
    }

    if (group.fragments.every((f) => f !== undefined)) {
      this.groups.delete(key);
      return { payload: group.fragments.join(""), fillBits: group.fillBits };
    }

    this.gc();
    return null;
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, group] of this.groups) {
      if (now - group.firstSeenAt > this.maxAgeMs) {
        this.groups.delete(key);
      }
    }
  }

  /** Number of incomplete fragment groups currently buffered. */
  get pendingCount(): number {
    return this.groups.size;
  }
}
