// Dependency-free PNG icon generator for Nyx Reader.
// Draws a crescent moon + star on the night-theme background.
// Run: node scripts/gen-icons.mjs   (outputs into ./public)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

const BG = [21, 24, 28];      // #15181c night background
const MOON = [233, 212, 160]; // warm gold crescent

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function encodePNG(size, pixels /* RGBA Uint8Array */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  // rows with filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.subarray(y * stride, y * stride + stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// scale: fraction of the canvas the artwork occupies (for maskable safe zone)
function draw(size, { scale = 1, opaque = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.30 * scale;            // crescent outer radius
  const offX = R * 0.42, offY = -R * 0.12;  // carve circle offset
  const Rcut = R * 0.92;
  // star position (upper right of the crescent opening)
  const starX = cx + R * 0.55, starY = cy - R * 0.55, starR = size * 0.028 * scale;

  const set = (i, c, a = 255) => { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a; };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // anti-aliased background corners: keep square (platform masks), so fill all
      set(i, BG, opaque ? 255 : 255);

      const dx = x - cx, dy = y - cy;
      const dMain = Math.hypot(dx, dy);
      const dCut = Math.hypot(x - (cx + offX), y - (cy + offY));
      // crescent = inside outer circle AND outside cut circle
      const inMain = R - dMain;          // >0 inside
      const outCut = dCut - Rcut;        // >0 outside cut
      const edge = Math.min(inMain, outCut);
      if (edge > -1.2) {
        const a = Math.max(0, Math.min(1, edge + 0.6));
        const r = Math.round(BG[0] + (MOON[0] - BG[0]) * a);
        const g = Math.round(BG[1] + (MOON[1] - BG[1]) * a);
        const b = Math.round(BG[2] + (MOON[2] - BG[2]) * a);
        set(i, [r, g, b]);
      }
      // little star
      const ds = Math.hypot(x - starX, y - starY);
      if (ds < starR + 0.8) {
        const a = Math.max(0, Math.min(1, starR + 0.8 - ds));
        const r = Math.round(px[i] + (MOON[0] - px[i]) * a);
        const g = Math.round(px[i + 1] + (MOON[1] - px[i + 1]) * a);
        const b = Math.round(px[i + 2] + (MOON[2] - px[i + 2]) * a);
        set(i, [r, g, b]);
      }
    }
  }
  return px;
}

const targets = [
  { name: "pwa-192.png", size: 192, opts: {} },
  { name: "pwa-512.png", size: 512, opts: {} },
  { name: "pwa-maskable-512.png", size: 512, opts: { scale: 0.66 } }, // content in safe zone
  { name: "apple-touch-icon.png", size: 180, opts: {} },
  { name: "favicon-32.png", size: 32, opts: {} },
];
for (const t of targets) {
  writeFileSync(join(OUT, t.name), encodePNG(t.size, draw(t.size, t.opts)));
  console.log("wrote", t.name);
}
