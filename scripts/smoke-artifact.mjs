// Confere a variante do link do claude.ai (dist-artifact/) num navegador de verdade, com um `window.claude`
// simulado (banco em memória com os 14 perfumes, assets e user) — o mesmo caminho de código da página publicada.
// Uso: npm run build:artifact && node scripts/smoke-artifact.mjs
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve('dist-artifact');
const seed = JSON.parse(readFileSync('apps/web/src/data/seed.json', 'utf8'));
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'preview.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/webp' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4180, '127.0.0.1', r));

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript((docs) => {
  const store = new Map(docs.map((d) => [d.id, d]));
  const listeners = new Set();
  const snap = () => ({ docs: [...store.values()].map((d) => ({ id: d.id, exists: true, data: () => d })) });
  const emit = () => listeners.forEach((l) => l(snap()));
  const db = {
    collection: () => ({
      doc: (id) => ({
        set: async (data) => (store.set(id, data), emit()),
        delete: async () => (store.delete(id), emit()),
      }),
      onSnapshot: (next) => (listeners.add(next), setTimeout(() => next(snap()), 50), () => listeners.delete(next)),
    }),
  };
  window.__store = store;
  window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? { isOwner: () => true } : name === 'assets' ? { upload: async () => ({ id: 'x' }), delete: async () => {} } : null) };
}, seed);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:4180/preview.html');
await page.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
await page.waitForTimeout(1500);
const count = await page.locator('.tab__count').first().innerText();
const font = await page.evaluate(() => document.fonts.check('300 20px "Archivo Variable"'));
await page.getByRole('button', { name: /Comprei/ }).click();
await page.waitForTimeout(1500);
const owned = await page.evaluate(() => [...window.__store.values()].filter((p) => p.status === 'owned').map((p) => p.id));
await page.getByRole('button', { name: 'Adicionar perfume' }).click();
await page.locator('.sheet input[type="url"]').fill('https://www.notino.fr/lattafa/khamrah-eau-de-parfum-mixte/');
await page.locator('.sheet button[type="submit"]').click();
await page.waitForSelector('.review', { timeout: 8000 });
const guessed = await page.locator('.review__fields input').first().inputValue();
await page.screenshot({ path: 'scripts/.shots/artifact-guess.png' });
await browser.close();
server.close();

const ok = count === '14' && font && owned.length === 1 && guessed === 'Khamrah' && errors.length === 0;
console.log({ wishlist: count, fonteEmbutida: font, gravouNoBanco: owned, palpitePeloLink: guessed, erros: errors });
console.log(ok ? 'Variante do link: ok' : 'Variante do link: FALHOU');
process.exit(ok ? 0 : 1);
