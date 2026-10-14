// Captures de sites publics (lecture seule, comme un visiteur) : 4 vues carrées par site — début, 1/3, 2/3, fin.
// Les bandeaux de cookies sont seulement MASQUÉS (CSS) : aucun consentement n'est donné ni refusé.
// Usage : node assets-src/real-sites/capture.mjs <dossier-sortie> <nom>=<url> [<nom>=<url> …] [--top-only]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const out = path.resolve(args[0]);
const topOnly = args.includes('--top-only');
const sites = args.slice(1).filter((a) => a.includes('=')).map((a) => a.split(/=(.+)/));
mkdirSync(out, { recursive: true });

const HIDE = `
#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter, #didomi-host, .didomi-popup-backdrop, #axeptio_overlay,
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, #usercentrics-root, #cmpwrapper, .cc-window, .cookie-banner, .cookie-consent,
#cookie-banner, #cookie-notice, #cookies-banner, [id*="cookie" i][class*="banner" i], [class*="CookieBanner"], [class*="cookie-banner"],
#tarteaucitronRoot, #truste-consent-track, .qc-cmp2-container, #sp_message_container, [aria-label*="cookie" i][role="dialog"],
[aria-label*="consent" i][role="dialog"], #hs-eu-cookie-confirmation, .osano-cm-window, #ccc, #termly-code-snippet-support,
#iubenda-cs-banner, .fc-consent-root { display: none !important; }
html, body { overflow: auto !important; }`;

const SIZE = 1280;

/** Ferme les fenêtres promotionnelles / sélecteurs de pays par leur bouton « fermer » (jamais « accepter »). */
async function dismissModals(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const closers = page.locator(
    '[role="dialog"] button[aria-label*="close" i], [role="dialog"] button[aria-label*="fermer" i], .modal button[aria-label*="close" i], .modal button[aria-label*="fermer" i], [class*="modal" i] button[class*="close" i], [class*="popup" i] button[class*="close" i]',
  );
  const n = await closers.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const b = closers.nth(i);
    if (await b.isVisible().catch(() => false)) await b.click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const [name, url] of sites) {
  const context = await browser.newContext({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissModals(page);
    if (topOnly) {
      await page.screenshot({ path: path.join(out, `${name}-top.png`) });
      console.log('ok', name, page.url());
      continue;
    }
    // Défilement lent jusqu'en bas : déclenche le chargement paresseux et les animations d'apparition.
    const total = await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.5);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 350));
      }
      return document.documentElement.scrollHeight;
    });
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    await dismissModals(page);
    const max = Math.max(0, total - SIZE);
    const stops = [0, Math.round(max / 3), Math.round((2 * max) / 3), max];
    for (const [i, y] of stops.entries()) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `${name}-${i + 1}.png`) });
    }
    console.log('ok', name, page.url(), 'hauteur', total, 'positions', stops.join(','));
  } catch (e) {
    console.log('ÉCHEC', name, e.message.split('\n')[0]);
  } finally {
    await context.close();
  }
}
await browser.close();
