// Folha de contato: miniaturas de vários quadros com o instante embaixo. uso: node tools/contact.mjs <pasta> <saida.png> [colunas] [largura]
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [dir, out, colsArg, wArg] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const cols = Number(colsArg ?? 7), w = Number(wArg ?? 270), h = Math.round((w * 16) / 9), lab = 26;
const tiles = await Promise.all(files.map(async (f) => {
  const img = await sharp(path.join(dir, f)).resize(w, h).toBuffer();
  const label = Buffer.from(`<svg width="${w}" height="${lab}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="6" y="18" fill="#ddd" font-family="Segoe UI" font-size="15">${f.replace(/\.png$/, '')}</text></svg>`);
  return sharp({ create: { width: w, height: h + lab, channels: 3, background: '#111' } }).composite([{ input: img, top: 0, left: 0 }, { input: label, top: h, left: 0 }]).png().toBuffer();
}));
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * (w + 4), height: rows * (h + lab + 4), channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * (w + 4), top: Math.floor(i / cols) * (h + lab + 4) })))
  .png().toFile(out);
console.log(out, tiles.length);
