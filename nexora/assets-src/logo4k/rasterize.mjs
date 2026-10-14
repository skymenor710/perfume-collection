// Rastérise les masques vectoriels (out/*.svg) avec Chromium (rendu des courbes de Bézier plus fidèle que librsvg) :
//   node assets-src/logo4k/rasterize.mjs 3840
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const size = Number(process.argv[2] ?? 3840);
const dir = 'assets-src/logo4k/out/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

async function render(file, w, h, out) {
  const svg = readFileSync(file, 'utf8')
    .replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`)
    .replace(/fill="#[0-9A-Fa-f]+"/, 'fill="#fff"');
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<style>html,body{margin:0;background:#000}svg{display:block}</style>${svg}`);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  await sharp(png).extractChannel('red').png().toFile(out);
}

for (const name of ['symbol-silhouette', 'symbol-wine', 'symbol-light', 'symbol-panels']) {
  await render(`${dir}${name}.svg`, size, size, `${dir}${name}-${size}.png`);
}
const [, ww, wh] = /viewBox="0 0 (\d+) (\d+)"/.exec(readFileSync(`${dir}wordmark.svg`, 'utf8'));
const W = Math.round(size * 0.9), H = Math.round((W * wh) / ww);
await render(`${dir}wordmark.svg`, W, H, `${dir}wordmark-${size}.png`);
await browser.close();
console.log('ok', size, W, H);
