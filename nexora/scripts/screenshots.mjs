// Captures d'écran du site public à plusieurs largeurs (+ erreurs console et débordement horizontal).
//   node scripts/screenshots.mjs [url] [dossier-sortie] [largeurs, ex. 1440,390]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3000/';
const out = path.resolve(process.argv[3] ?? 'docs/screenshots');
const widths = (process.argv[4] ?? '1440,390').split(',').map(Number);
const heights = { 375: 812, 390: 844, 768: 1024, 1440: 900, 1920: 1080 };
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let failures = 0;
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: heights[w] ?? 900 }, deviceScaleFactor: w < 800 ? 2 : 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`requête échouée : ${r.url()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `home-${w}-viewport.png`) });
  // Parcours complet pour déclencher les apparitions au défilement, puis capture pleine page.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(out, `home-${w}-full.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${w}px : débordement horizontal = ${overflow}px, erreurs console = ${errors.length}`);
  if (errors.length) console.log('  ' + errors.join('\n  '));
  if (overflow > 0 || errors.length) failures++;
  await page.close();
}
await browser.close();
process.exitCode = failures ? 1 : 0;
