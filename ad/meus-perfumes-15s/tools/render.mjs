/**
 * Renderiza o anúncio quadro a quadro: abre src/ad.html no Edge headless, chama window.renderAt(t) e fotografa.
 * Cada quadro é independente (função do tempo), então vários navegadores trabalham em paralelo.
 *
 *   node tools/render.mjs                         15 s a 60 qps → frames/f_00000.png …
 *   node tools/render.mjs --times=0,1.5,6         só estes instantes → out/stills/t_01.500.png
 *   node tools/render.mjs --from=5 --to=7         um trecho
 *   node tools/render.mjs --jobs=frames-mb/jobs.json   uma lista [{t, i, file}] (subquadros do desfoque de movimento)
 *   --fps=60 --workers=6 --out=frames
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const AD = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = '1'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const fps = Number(args.fps ?? 60);
const workers = Number(args.workers ?? 6);

let jobs;
if (args.jobs) {
  jobs = JSON.parse(readFileSync(path.resolve(AD, args.jobs), 'utf8')).map((j) => ({ ...j, file: path.resolve(AD, j.file) }));
  for (const d of new Set(jobs.map((j) => path.dirname(j.file)))) mkdirSync(d, { recursive: true });
} else if (args.times) {
  const dir = path.resolve(AD, args.out ?? 'out/stills');
  mkdirSync(dir, { recursive: true });
  jobs = args.times.split(',').map((s) => {
    const t = Number(s);
    return { t, i: Math.round(t * fps), file: path.join(dir, `t_${t.toFixed(3).padStart(6, '0')}.png`) };
  });
} else {
  const dir = path.resolve(AD, args.out ?? 'frames');
  mkdirSync(dir, { recursive: true });
  const from = Math.round(Number(args.from ?? 0) * fps);
  const to = Math.round(Number(args.to ?? 15) * fps);
  jobs = [];
  for (let i = from; i < to; i++) jobs.push({ t: i / fps, i, file: path.join(dir, `f_${String(i).padStart(5, '0')}.png`) });
}

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
if (!edge) throw new Error('Edge não encontrado');
const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: ['--force-color-profile=srgb', '--allow-file-access-from-files', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-lcd-text', '--font-render-hinting=none', '--hide-scrollbars'],
});
const url = pathToFileURL(path.join(AD, 'src', 'ad.html')).href;
let done = 0;
const started = Date.now();

async function run(list, w) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`[w${w}] pageerror`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(`[w${w}] console`, m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.adReady === true || Boolean(window.adError), null, { timeout: 120_000 });
  const error = await page.evaluate(() => window.adError);
  if (error) throw new Error(error);
  if (w === 0) console.log('info', JSON.stringify(await page.evaluate(() => window.AD_INFO)));
  for (const job of list) {
    await page.evaluate(([t, i]) => window.renderAt(t, i), [job.t, job.i]);
    await page.screenshot({ path: job.file, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    done++;
    if (done % 60 === 0 || done === jobs.length) {
      const s = (Date.now() - started) / 1000;
      console.log(`${done}/${jobs.length} quadros · ${s.toFixed(0)} s · ${((s / done) * 1000).toFixed(0)} ms/quadro`);
    }
  }
  await page.close();
}

const n = Math.max(1, Math.min(workers, jobs.length));
const parts = Array.from({ length: n }, () => []);
jobs.forEach((j, k) => parts[k % n].push(j));
try {
  await Promise.all(parts.map((p, w) => run(p, w)));
} finally {
  await browser.close();
}
console.log(`pronto: ${jobs.length} quadros em ${((Date.now() - started) / 1000).toFixed(1)} s`);
