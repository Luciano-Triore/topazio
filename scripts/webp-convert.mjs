// One-time build helper: convert the Topázio LP's PNGs (+ the TRIORE logo) to
// WebP so the live page ships a fraction of the original ~8 MB. Run with:
//
//   npm i -D sharp   (once)
//   node scripts/webp-convert.mjs
//
// sharp is a build-time dependency only — Cloudflare Pages serves the static
// .webp files; nothing here runs at the edge.

import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_FOTOS = path.join(ROOT, 'LP', 'fotos');
const OUT_FOTOS = path.join(ROOT, 'topazio', 'fotos');

// Only the 11 images actually referenced in LP/index.html (the 5 unused PNGs
// and bg-fachada.jpg are intentionally left behind).
const PHOTOS = [
  'fachada',
  'lp-academia',
  'lp-coworking',
  'lp-play',
  'lp-piscina',
  'lp-praca',
  'lp-ap',
  'tipo-3',
  'tipo-2',
  'tipo-1-dif',
  'tp-mapa',
];

const QUALITY = 78;

async function convert(srcPath, outPath, { lossless = false } = {}) {
  const info = await sharp(srcPath)
    .webp(lossless ? { lossless: true } : { quality: QUALITY })
    .toFile(outPath);
  const inSize = (await stat(srcPath)).size;
  return { inSize, outSize: info.size };
}

function line(name, inSize, outSize) {
  console.log(
    `${name.padEnd(14)} ${(inSize / 1024).toFixed(0).padStart(5)} KB -> ${(outSize / 1024).toFixed(0).padStart(5)} KB`,
  );
}

async function main() {
  await mkdir(OUT_FOTOS, { recursive: true });

  let totalIn = 0;
  let totalOut = 0;

  for (const name of PHOTOS) {
    const { inSize, outSize } = await convert(
      path.join(SRC_FOTOS, `${name}.png`),
      path.join(OUT_FOTOS, `${name}.webp`),
    );
    totalIn += inSize;
    totalOut += outSize;
    line(name, inSize, outSize);
  }

  // TRIORE hexagon logo — lossless keeps the transparent edges crisp at small size.
  const { inSize, outSize } = await convert(
    path.join(ROOT, 'logo.png'),
    path.join(OUT_FOTOS, 'logo-triore.webp'),
    { lossless: true },
  );
  totalIn += inSize;
  totalOut += outSize;
  line('logo-triore', inSize, outSize);

  console.log(
    `\nTOTAL          ${(totalIn / 1024).toFixed(0).padStart(5)} KB -> ${(totalOut / 1024).toFixed(0).padStart(5)} KB ` +
      `(${(100 - (totalOut / totalIn) * 100).toFixed(0)}% smaller)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
