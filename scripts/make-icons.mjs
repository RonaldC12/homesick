// Generates icons/icon{16,32,48,128}.png with no dependencies.
// Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const ss = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = ss * ss;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));

// Rounded-square tile: night sky, moon, two mountain ridges, water
function pixel(u, v) {
  const r = 0.22;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];

  let col = mixc([20, 34, 62], [70, 96, 128], v);
  // moon
  if ((u - 0.7) ** 2 + (v - 0.28) ** 2 < 0.09 ** 2) col = [243, 230, 196];
  // far ridge
  const far = 0.56 - 0.2 * Math.max(0, 1 - Math.abs(u - 0.36) / 0.36) - 0.08 * Math.max(0, 1 - Math.abs(u - 0.78) / 0.25);
  if (v > far) col = [92, 128, 150];
  // near ridge
  const near = 0.66 - 0.12 * Math.max(0, 1 - Math.abs(u - 0.62) / 0.4);
  if (v > near) col = [44, 74, 88];
  // water
  if (v > 0.72) {
    col = mixc([60, 108, 120], [24, 46, 62], (v - 0.72) / 0.28);
    if (Math.abs(v - 0.8) < 0.012 && u > 0.3 && u < 0.6) col = [143, 208, 195];
    if (Math.abs(v - 0.88) < 0.012 && u > 0.45 && u < 0.8) col = [143, 208, 195];
  }
  return [...col, 1];
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png(size, pixel));
}
console.log('icons written');
