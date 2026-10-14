// Captures des sites réalisés (portfolio) : 4 vues carrées par site — début, 1/3, 2/3, fin.
// Les noms et adresses des entreprises prospectées peuvent être floutés (comme dans le dossier de présentation).
// Usage : node assets-src/portfolio/capture.mjs <dossier-sortie> <config.json>
//   config : [{ "name": "awm", "url": "file:///…/awm.html", "blurText": ["AWM BIOTECH"], "blurSelectors": ["address"] }]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [outArg, configArg] = process.argv.slice(2);
const out = path.resolve(outArg);
const sites = JSON.parse(readFileSync(configArg, 'utf8'));
mkdirSync(out, { recursive: true });
const SIZE = 1280;

/** Floute les textes et blocs indiqués (identité d'un prospect), sans modifier le contenu. */
async function mask(page, site) {
  await page.evaluate(({ texts, selectors }) => {
    const css = document.createElement('style');
    css.textContent = `${selectors.join(',') || '.__none'}{filter:blur(7px)!important} .__nx-blur{filter:blur(6px);display:inline-block}`;
    document.head.appendChild(css);
    if (!texts.length) return;
    const re = new RegExp(texts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      const text = node.nodeValue;
      for (const m of text.matchAll(re)) {
        frag.append(text.slice(last, m.index));
        const s = document.createElement('span');
        s.className = '__nx-blur';
        s.textContent = m[0];
        frag.append(s);
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }, { texts: site.blurText ?? [], selectors: site.blurSelectors ?? [] });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const site of sites) {
  const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1, locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto(site.url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500); // animations d'entrée
  await mask(page, site);
  // Défilement lent jusqu'en bas : déclenche les apparitions et le chargement paresseux.
  const total = await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.4);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 300));
    }
    return document.documentElement.scrollHeight;
  });
  const max = Math.max(0, total - SIZE);
  const stops = site.stops ?? [0, 1 / 3, 2 / 3, 1];
  for (const [i, f] of stops.entries()) {
    const y = Math.round(max * f);
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(out, `${site.name}-${i + 1}.png`) });
  }
  console.log('ok', site.name, 'hauteur', total, 'positions', stops.map((f) => Math.round(max * f)).join(','));
  await context.close();
}
await browser.close();
