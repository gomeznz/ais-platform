/**
 * Test-only helpers that *encode* AIS fields into armored NMEA sentences —
 * the reverse of what src/ does. Keeping this independent of the decoder's
 * own bit-packing logic means the tests actually exercise the field-layout
 * math rather than just checking round-trip self-consistency.
 */

export function intToBits(value: number, len: number, signed = false): string {
  let v = value;
  if (signed && v < 0) v += Math.pow(2, len);
  return v.toString(2).padStart(len, "0").slice(-len);
}

function charToSixBitValue(code: number): number {
  if (code >= 64 && code <= 95) return code - 64;
  if (code >= 32 && code <= 63) return code;
  throw new Error(`Character code ${code} not encodable in AIS 6-bit text`);
}

export function textToBits(str: string, len: number): string {
  const numChars = len / 6;
  const padded = str.toUpperCase().slice(0, numChars).padEnd(numChars, "@");
  let bits = "";
  for (const c of padded) {
    bits += charToSixBitValue(c.charCodeAt(0)).toString(2).padStart(6, "0");
  }
  return bits;
}

export function armorBits(bits: string): { payload: string; fillBits: number } {
  const rem = bits.length % 6;
  const fillBits = rem === 0 ? 0 : 6 - rem;
  const padded = bits + "0".repeat(fillBits);
  let payload = "";
  for (let i = 0; i < padded.length; i += 6) {
    const v = parseInt(padded.slice(i, i + 6), 2);
    const code = v <= 39 ? v + 48 : v + 56;
    payload += String.fromCharCode(code);
  }
  return { payload, fillBits };
}

function computeChecksumHex(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, "0");
}

export function buildSentence(opts: {
  fragCount: number;
  fragNumber: number;
  seqId?: string;
  channel: string;
  payload: string;
  fillBits: number;
  corruptChecksum?: boolean;
}): string {
  const seq = opts.seqId ?? "";
  const body = `AIVDM,${opts.fragCount},${opts.fragNumber},${seq},${opts.channel},${opts.payload},${opts.fillBits}`;
  let cs = computeChecksumHex(body);
  if (opts.corruptChecksum) cs = cs === "00" ? "FF" : "00";
  return `!${body}*${cs}`;
}
