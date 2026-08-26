/** A parsed (but not yet payload-decoded) AIVDM/AIVDO sentence. */
export interface NmeaAisSentence {
  talkerId: string; // e.g. "AI", "AB", "BS"
  formatter: "VDM" | "VDO";
  fragCount: number;
  fragNumber: number;
  seqId: string | null;
  channel: string | null;
  payload: string;
  fillBits: number;
  checksumOk: boolean;
}

function computeChecksum(body: string): number {
  let cs = 0;
  for (let i = 0; i < body.length; i++) {
    cs ^= body.charCodeAt(i);
  }
  return cs;
}

/**
 * Parse a raw NMEA line into its AIVDM/AIVDO fields. Returns null if the
 * line isn't a recognizable AIS sentence (wrong talker/formatter, malformed
 * structure). Sentences that fail checksum validation are still returned
 * with checksumOk=false so callers can decide whether to drop them.
 */
export function parseNmeaSentence(line: string): NmeaAisSentence | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!") && !trimmed.startsWith("$")) return null;

  const starIdx = trimmed.lastIndexOf("*");
  const body = starIdx >= 0 ? trimmed.slice(1, starIdx) : trimmed.slice(1);
  const declaredChecksum = starIdx >= 0 ? trimmed.slice(starIdx + 1, starIdx + 3) : null;

  const fields = body.split(",");
  if (fields.length < 6) return null;

  const header = fields[0]; // e.g. "AIVDM"
  if (header.length < 5) return null;
  const talkerId = header.slice(0, 2);
  const formatter = header.slice(2) as "VDM" | "VDO";
  if (formatter !== "VDM" && formatter !== "VDO") return null;

  const fragCount = parseInt(fields[1], 10);
  const fragNumber = parseInt(fields[2], 10);
  const seqId = fields[3] === "" ? null : fields[3];
  const channel = fields[4] === "" ? null : fields[4];
  const payload = fields[5] ?? "";
  const fillBits = parseInt(fields[6] ?? "0", 10) || 0;

  let checksumOk = true;
  if (declaredChecksum) {
    const actual = computeChecksum(body)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0");
    checksumOk = actual === declaredChecksum.toUpperCase();
  }

  if (Number.isNaN(fragCount) || Number.isNaN(fragNumber)) return null;

  return {
    talkerId,
    formatter,
    fragCount,
    fragNumber,
    seqId,
    channel,
    payload,
    fillBits,
    checksumOk,
  };
}
