// Teste no Google Chrome instalado no PC (perfil limpo), contra o app que roda sozinho em http://localhost:3100 —
// sem Claude, sem extensão, sem MCP. Cobre o cenário que falhava: abrir outra aba NO MEIO de uma importação.
// Uso: node scripts/chrome-real.mjs <link-de-perfume-novo>
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:3100';
const LINK = process.argv[2];
const SHOTS = path.resolve('scripts/.shots');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const profile = mkdtempSync(path.join(os.tmpdir(), 'chrome-real-'));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: false, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(APP);
await page.waitForSelector('.nameplate__name', { timeout: 30000 });
const before = await page.evaluate(async () => (await (await fetch('api/perfumes')).json()).perfumes.length);
check('Chrome abre o app servido pelo próprio app (marca de servidor na página)', await page.evaluate(() => Boolean(document.querySelector('meta[name="perfumes-server"]'))), `${before} perfumes`);
check('Coleção do servidor na tela (não a do navegador)', (await page.locator('.tab__count').first().innerText()) !== '', await page.locator('.tab__count').first().innerText());

// Adicionar por link de loja que bloqueia leitura.
await page.getByRole('button', { name: 'Adicionar perfume' }).first().click();
await page.locator('.sheet input[type="url"]').fill(LINK);
await page.locator('.sheet button[type="submit"]').click();
const stages = new Set();
const watch = setInterval(() => page.locator('.analyzing__text').innerText({ timeout: 200 }).then((t) => stages.add(t.trim())).catch(() => {}), 150);

// No meio da importação: outra aba. Antes, ela concluía "sem servidor" e caía no modo que não abre links.
await page.waitForTimeout(9000);
const second = await ctx.newPage();
const t0 = Date.now();
await second.goto(APP);
await second.waitForSelector('.nameplate__name, .empty__title', { timeout: 30000 });
const secondMode = await second.evaluate(async () => {
  const count = document.querySelector('.tab__count')?.textContent;
  const hint = document.querySelector('.sheet__hint')?.textContent ?? null;
  return { count, hint, marker: Boolean(document.querySelector('meta[name="perfumes-server"]')) };
});
check('Aba aberta durante a importação continua no app do computador', secondMode.marker && secondMode.count === String(before) && !secondMode.hint, `abriu em ${Date.now() - t0} ms, ${secondMode.count} perfumes`);
await second.close();

await page.waitForFunction(() => !document.querySelector('.analyzing') && (!document.querySelector('.sheet') || document.querySelector('.preview, .variants, .unidentified')), null, { timeout: 240000 });
clearInterval(watch);
check('Etapas de progresso, sem erro técnico', stages.size >= 3 && ![...stages].some((t) => /cors|403|fetch|timeout|econn|cloudflare|playwright|mcp/i.test(t)), [...stages].join(' → '));

if (await page.locator('.variants').count()) {
  await page.screenshot({ path: path.join(SHOTS, 'chrome-variants.png') });
  await page.locator('.variant').first().click();
  await page.locator('.variants button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('.analyzing') && (!document.querySelector('.sheet') || document.querySelector('.preview, .unidentified')), null, { timeout: 240000 });
}
if (await page.locator('.preview').count()) {
  await page.screenshot({ path: path.join(SHOTS, 'chrome-preview.png') });
  await page.getByRole('button', { name: 'Adicionar à wishlist' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 15000 });
}
await page.waitForTimeout(2500);
const after = await page.evaluate(async () => (await (await fetch('api/perfumes')).json()).perfumes);
const added = after.find((p) => p.sourceUrl && p.origin === 'url-import' && !['xerjoff-zefiro-we1txa', 'french-avenue-azzure-aoud-7m3nwa'].includes(p.id) && Date.now() - Date.parse(p.createdAt) < 10 * 60_000);
check('Perfume entrou sem digitar nada', Boolean(added), added ? `${added.brand} · ${added.name} · ${added.concentration ?? '—'} · ${added.volume ?? '—'} · ${added.price ?? '—'} ${added.currency ?? ''}` : 'nada novo');
if (added) {
  check('Foto: PNG mestre + webp no quadro padrão, com origem', Boolean(added.masterUrl && added.imageUrl && added.imageSource?.label), `${added.imageSource?.label} (${added.imageSource?.score})`);
  check('Perfil olfativo com fonte', Boolean(added.olfactoryProfile?.source), added.olfactoryProfile?.source);
  check('Link original guardado para o ↗', added.sourceUrl === LINK, added.sourceUrl);
  const square = await page.evaluate(() => document.querySelector('.slot.is-focus .bottle__art')?.getAttribute('data-canvas'));
  check('Frasco no palco no quadro quadrado', square === 'square', square);
  await page.screenshot({ path: path.join(SHOTS, 'chrome-added.png') });
  console.log(`ID_ADICIONADO=${added.id}`);
}
check('Nenhum erro de script no Chrome', errors.length === 0, errors.slice(0, 2).join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} verificações no Chrome real.`);
