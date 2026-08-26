/**
 * Buffers arbitrary chunk boundaries from a socket/stream into complete
 * lines (NMEA sentences are newline-terminated but TCP gives no guarantee
 * a `data` event lines up with sentence boundaries).
 */
export class LineFramer {
  private buffer = "";
  private onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }
}
