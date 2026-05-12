/**
 * Flood-fill from image edges: remove contiguous near-white pixels (background)
 * while keeping interior white graphic elements that are separated by dark pixels.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = path.join(process.cwd(), "tmp-turntable-src.png");
const OUT = path.join(process.cwd(), "public/dj-turntable.png");

function isBackgroundPixel(r, g, b) {
  const M = Math.max(r, g, b);
  const m = Math.min(r, g, b);
  const sat = M === 0 ? 0 : (M - m) / M;
  if (r >= 248 && g >= 248 && b >= 248) return true;
  if (r >= 235 && g >= 235 && b >= 235 && sat < 0.06) return true;
  return false;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Missing", SRC);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  if (ch !== 4) throw new Error(`Expected RGBA, got ${ch} channels`);

  const visited = new Uint8Array(w * h);
  /** @type {number[]} */
  const queue = [];

  const trySeed = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    const i = p * 4;
    if (!isBackgroundPixel(data[i], data[i + 1], data[i + 2])) return;
    visited[p] = 1;
    queue.push(x, y);
  };

  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++];
    const y = queue[qi++];
    const p = y * w + x;
    const i = p * 4;
    data[i + 3] = 0;

    const neigh = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neigh) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (visited[np]) continue;
      const ni = np * 4;
      if (!isBackgroundPixel(data[ni], data[ni + 1], data[ni + 2])) continue;
      visited[np] = 1;
      queue.push(nx, ny);
    }
  }

  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(OUT);

  console.log("Wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
