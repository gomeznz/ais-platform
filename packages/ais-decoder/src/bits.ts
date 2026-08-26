/**
 * AIS payloads are "armored" as 6-bit ASCII: each character encodes 6 bits.
 * This module turns an armored payload string into a flat bit string and
 * provides helpers to pull fixed-width integer / text fields out of it,
 * matching the ITU-R M.1371 field layouts.
 */

/** Decode one armored payload character into its 6-bit value (0-63). */
function charToSixBit(c: string): number {
  let v = c.charCodeAt(0) - 48;
  if (v > 40) v -= 8;
  if (v < 0 || v > 63) {
    throw new Error(`Invalid AIS payload character: ${c}`);
  }
  return v;
}

/** Convert an armored payload (plus fill-bit count) into a '0'/'1' bit string. */
export function payloadToBitString(payload: string, fillBits: number): string {
  let bits = "";
  for (const c of payload) {
    const v = charToSixBit(c);
    bits += v.toString(2).padStart(6, "0");
  }
  if (fillBits > 0) {
    bits = bits.slice(0, bits.length - fillBits);
  }
  return bits;
}

export class BitReader {
  private bits: string;

  constructor(bits: string) {
    this.bits = bits;
  }

  get length(): number {
    return this.bits.length;
  }

  /** Unsigned integer from bit range [start, start+len). */
  uint(start: number, len: number): number {
    const slice = this.bits.slice(start, start + len);
    if (slice.length === 0) return 0;
    return parseInt(slice, 2) >>> 0;
  }

  /** Unsigned integer wide enough to exceed 32 bits (e.g. MMSI, IMO combos). */
  uintBig(start: number, len: number): number {
    const slice = this.bits.slice(start, start + len);
    if (slice.length === 0) return 0;
    return Number(BigInt(`0b${slice}`));
  }

  /** Two's-complement signed integer from bit range [start, start+len). */
  int(start: number, len: number): number {
    const slice = this.bits.slice(start, start + len);
    if (slice.length === 0) return 0;
    const unsigned = parseInt(slice, 2);
    const signBit = 1 << (len - 1);
    return unsigned & signBit ? unsigned - (1 << len) : unsigned;
  }

  /** Boolean flag from a single bit. */
  bool(start: number): boolean {
    return this.bits[start] === "1";
  }

  /**
   * 6-bit-ASCII text field: each 6 bits maps to a character (0-31 -> '@'..'_',
   * 32-63 -> ' '..'?'), used for names/call signs/destinations. Trailing
   * '@' and spaces are trimmed per spec.
   */
  text(start: number, len: number): string {
    const slice = this.bits.slice(start, start + len);
    let out = "";
    for (let i = 0; i + 6 <= slice.length; i += 6) {
      const v = parseInt(slice.slice(i, i + 6), 2);
      const code = v < 32 ? v + 64 : v;
      out += String.fromCharCode(code);
    }
    return out.replace(/[@\s]+$/g, "").trim();
  }
}
