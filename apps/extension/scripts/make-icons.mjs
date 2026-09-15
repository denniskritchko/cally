import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/icons';
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// SFU red rounded square, white calendar "page" with a red header band and three white dots.
const RED = [200, 16, 46], WHITE = [255, 255, 255];
function icon(size) {
  const r = size * 0.22;
  const inRounded = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad - 1), cy = Math.min(Math.max(y, y0 + rad), y1 - rad - 1);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad + 0.5;
  };
  return png(size, (x, y) => {
    if (!inRounded(x, y, 0, 0, size, size, r)) return [0, 0, 0, 0];
    const px0 = size * 0.2, py0 = size * 0.22, px1 = size * 0.8, py1 = size * 0.82;
    if (inRounded(x, y, px0, py0, px1, py1, size * 0.08)) {
      if (y < py0 + (py1 - py0) * 0.28) return [...RED, 255].map((v, i) => (i < 3 ? Math.round(v * 0.75) : v)); // header band
      // dots (due-date blobs)
      const rows = [0.52, 0.7], cols = [0.33, 0.5, 0.67];
      for (const ry of rows) for (const cx of cols) {
        const dx = x - size * cx, dy = y - size * ry;
        if (dx * dx + dy * dy <= (size * 0.05) ** 2) return [...RED, 255];
      }
      return [...WHITE, 255];
    }
    return [...RED, 255];
  });
}

for (const s of [16, 32, 48, 128]) writeFileSync(join(outDir, `icon${s}.png`), icon(s));
console.log(`icons → ${outDir}`);
