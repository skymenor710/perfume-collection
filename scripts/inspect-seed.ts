/**
 * Ferramenta de conferência (não roda no app): baixa as fotos da semente, recorta e monta uma prancha
 * sobre o preto do app, com a cor dominante ao lado — para julgar recorte e cor com os olhos.
 * Uso: npx tsx scripts/inspect-seed.ts <saída.png> [url extra ...]
 */
import { writeFileSync } from 'node:fs';
import sharp, { type OverlayOptions } from 'sharp';
import { processBottleImage } from '../apps/server/src/media/process';
import { SEED } from './seed-source';

const out = process.argv[2] ?? 'seed-sheet.png';
const extra = process.argv.slice(3);
const items = [...SEED.map((s) => ({ label: `${s.brand} ${s.name}`, url: s.image, cutout: s.cutout })), ...extra.map((url) => ({ label: url.slice(-40), url, cutout: undefined }))];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const CELL_W = 300;
const CELL_H = 420;
const cols = 6;
const rows = Math.ceil(items.length / cols);
const composites: OverlayOptions[] = [];

for (const [i, item] of items.entries()) {
  const res = await fetch(item.url, { headers: { 'user-agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  const p = await processBottleImage(buf, item.cutout);
  console.log(`${i}\t${res.status}\t${p.cutout ? 'recortado' : 'SEM RECORTE'}\t${p.color.hex}\t${p.color.neutral ? 'neutro' : 'cor'}\t${p.color.coverage.toFixed(2)}\t${item.label}`);
  const img = await sharp(p.large).resize(CELL_W - 20, CELL_H - 60, { fit: 'inside' }).toBuffer();
  const x = (i % cols) * CELL_W;
  const y = Math.floor(i / cols) * CELL_H;
  composites.push({ input: img, left: x + 10, top: y + 10 });
  const swatch = await sharp({ create: { width: CELL_W - 20, height: 30, channels: 3, background: p.color.hex } }).png().toBuffer();
  composites.push({ input: swatch, left: x + 10, top: y + CELL_H - 42 });
}

const sheet = await sharp({ create: { width: cols * CELL_W, height: rows * CELL_H, channels: 3, background: '#0b0b0e' } })
  .composite(composites)
  .png()
  .toBuffer();
writeFileSync(out, sheet);
console.log('prancha:', out);
