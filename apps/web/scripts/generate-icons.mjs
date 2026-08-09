// Rasterises public/icon.svg into the PNG + ICO sizes browsers and phones ask
// for. Run by hand after editing the SVG:
//
//   node apps/web/scripts/generate-icons.mjs
//
// The outputs are committed, so a normal build never runs this. `sharp` is a
// dependency of @gm/api rather than of the web app — .npmrc sets
// node-linker=hoisted for Expo's sake, so it resolves from the workspace root
// and there's no reason to install a second copy just for a one-off script.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

/** PNG sizes: the two the manifest names, plus the iOS home-screen icon. */
const PNGS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

/** Sizes packed into favicon.ico, for the browsers that still ask for it. */
const ICO_SIZES = [16, 32, 48];

async function render(svg, size) {
  return sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Packs PNGs into an .ico. Every browser since IE Vista reads PNG-compressed
 * entries, which keeps this to a header plus one directory row per size
 * instead of hand-rolling BMP scanlines and an AND mask.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size — 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const svg = await readFile(join(publicDir, "icon.svg"));
await mkdir(publicDir, { recursive: true });

for (const { file, size } of PNGS) {
  await writeFile(join(publicDir, file), await render(svg, size));
  console.log(`wrote ${file} (${size}px)`);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, data: await render(svg, size) });
}
await writeFile(join(publicDir, "favicon.ico"), buildIco(icoImages));
console.log(`wrote favicon.ico (${ICO_SIZES.join(", ")}px)`);
