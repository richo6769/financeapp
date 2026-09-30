// Generates PNG app icons (no image deps): teal tile with three rising bars.
import fs from "node:fs";
import zlib from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, { maskable }) {
  const bg = [15, 118, 110];
  const fg = [255, 255, 255];
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.2 : size * 0.12; // keep glyph in safe zone
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bars = [0.45, 0.65, 0.9];
  const area = size - inset * 2;
  const barW = area / 5;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const inside = radius === 0 || dx * dx + dy * dy <= radius * radius;
      let color = inside ? bg : null;
      if (inside) {
        bars.forEach((h, i) => {
          const x0 = inset + barW * (0.5 + i * 1.5);
          const top = inset + area * (1 - h);
          if (x >= x0 && x < x0 + barW && y >= top && y < size - inset) color = fg;
        });
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (color) {
        raw[o] = color[0];
        raw[o + 1] = color[1];
        raw[o + 2] = color[2];
        raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/icon-192.png", png(192, { maskable: false }));
fs.writeFileSync("public/icons/icon-512.png", png(512, { maskable: false }));
fs.writeFileSync("public/icons/icon-maskable-512.png", png(512, { maskable: true }));
fs.writeFileSync("public/icons/apple-touch-icon.png", png(180, { maskable: true }));
console.log("icons written to public/icons");
