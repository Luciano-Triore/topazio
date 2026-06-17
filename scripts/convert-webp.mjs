// Throwaway: converte os PNGs de topazio2/fotos para WebP em topaziob/fotos.
// Uso: node scripts/convert-webp.mjs
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import { join, parse } from 'node:path';

const SRC = 'topazio2/fotos';
const OUT = 'topaziob/fotos';

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter(f => /\.png$/i.test(f));

for (const f of files) {
  const { name } = parse(f);
  const dest = join(OUT, `${name}.webp`);
  const info = await sharp(join(SRC, f)).webp({ quality: 82 }).toFile(dest);
  console.log(`${f} -> ${name}.webp  (${(info.size / 1024).toFixed(0)} KB, ${info.width}x${info.height})`);
}
console.log(`\nDone: ${files.length} arquivos.`);
