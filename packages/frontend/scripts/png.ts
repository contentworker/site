/** Tiny PNG writer for placeholder images (the mock media origin and the seed). No binaries in git. */
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A width×height RGB PNG: a soft diagonal gradient, so it looks like a photo placeholder. */
const pngCache = new Map<string, Buffer>();
export function png(width: number, height: number, seed: number): Buffer {
  const key = `${width}x${height}:${seed}`;
  const hit = pngCache.get(key);
  if (hit) return hit;
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const i = y * row + 1 + x * 3;
      raw[i] = 40 + Math.round(120 * t) + (seed % 40);
      raw[i + 1] = 60 + Math.round(80 * (1 - t));
      raw[i + 2] = 110 + Math.round(100 * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  pngCache.set(key, out);
  return out;
}
