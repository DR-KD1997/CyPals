/**
 * Minimal PNG chunk reader/writer for character cards.
 *
 * Character cards embed JSON as base64 in tEXt chunks:
 *   - keyword "chara" → V1 or V2 card
 *   - keyword "ccv3"  → V3 card (takes precedence when both exist)
 * Some tools write iTXt or zTXt instead; we read those too.
 */
import { inflateSync } from "fflate";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) throw new Error(`Truncated PNG chunk ${type}`);
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    off = dataEnd + 4; // skip CRC
    if (type === "IEND") break;
  }
  return chunks;
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

/** Returns keyword → text for every tEXt / zTXt / iTXt chunk. */
export function readTextChunks(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of readChunks(bytes)) {
    if (c.type !== "tEXt" && c.type !== "zTXt" && c.type !== "iTXt") continue;
    const nul = c.data.indexOf(0);
    if (nul < 0) continue;
    const keyword = latin1.decode(c.data.subarray(0, nul));
    let text: string;
    if (c.type === "tEXt") {
      text = latin1.decode(c.data.subarray(nul + 1));
    } else if (c.type === "zTXt") {
      // keyword\0 method(1) compressed
      text = latin1.decode(inflateSync(c.data.subarray(nul + 2)));
    } else {
      // iTXt: keyword\0 compFlag compMethod lang\0 translated\0 text
      const compressed = c.data[nul + 1] === 1;
      let p = nul + 3;
      const langEnd = c.data.indexOf(0, p);
      p = langEnd + 1;
      const transEnd = c.data.indexOf(0, p);
      p = transEnd + 1;
      const body = c.data.subarray(p);
      text = utf8.decode(compressed ? inflateSync(body) : body);
    }
    // Later chunks with the same keyword win, matching common card tools.
    out.set(keyword, text);
  }
  return out;
}

// ───────────── writing ─────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Returns a copy of `png` with the given tEXt entries set (existing text chunks
 * with the same keywords are removed). Values must be Latin-1 safe — card JSON
 * is base64-encoded first, so this holds.
 */
export function writeTextChunks(png: Uint8Array, entries: Record<string, string>): Uint8Array {
  const keys = new Set(Object.keys(entries));
  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE)];
  for (const c of readChunks(png)) {
    if ((c.type === "tEXt" || c.type === "iTXt" || c.type === "zTXt") && keys.has(textKeyword(c.data))) continue;
    if (c.type === "IEND") {
      for (const [k, v] of Object.entries(entries)) {
        const kw = latin1Bytes(k);
        const body = latin1Bytes(v);
        const data = new Uint8Array(kw.length + 1 + body.length);
        data.set(kw, 0);
        data.set(body, kw.length + 1);
        parts.push(encodeChunk("tEXt", data));
      }
    }
    parts.push(encodeChunk(c.type, c.data));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function textKeyword(data: Uint8Array): string {
  const nul = data.indexOf(0);
  return nul < 0 ? "" : latin1.decode(data.subarray(0, nul));
}

/** 1×1 transparent PNG, used when exporting a card for a character with no portrait. */
export const BLANK_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
