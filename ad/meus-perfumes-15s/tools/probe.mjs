// Inspeção pontual da página do anúncio (depuração): node tools/probe.mjs <t> "<expressão JS>"
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const [t, expr] = process.argv.slice(2);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--force-color-profile=srgb', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '../src/ad.html')).href);
await page.waitForFunction(() => window.adReady || window.adError);
await page.evaluate((x) => window.renderAt(Number(x)), t);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
