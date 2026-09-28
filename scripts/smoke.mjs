// Teste de fumaça dos 7 fluxos do V1, num navegador de verdade (Edge/Chrome instalado, headless).
// Sobe um servidor próprio com dados temporários (a coleção de verdade em data/ não é tocada),
// percorre os fluxos, confere o DOM e grava capturas em .impeccable/review/ e scripts/.shots/.
// Uso: npm run build && npm run smoke   (SMOKE_IMPORT_URL=… troca o link usado no fluxo 4)
//      npm run smoke -- --backend=postgres   o mesmo teste com a coleção no Postgres (PGlite temporário)
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const IMPORT_URL = process.env.SMOKE_IMPORT_URL ?? 'https://royaloudleicester.com/products/rasasi-hawas-fire-eau-de-parfum-100ml';
const REVIEW = path.resolve('.impeccable/review');
const SHOTS = path.resolve('scripts/.shots');
mkdirSync(REVIEW, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const executablePath = browsers.find((p) => existsSync(p));
if (!executablePath) throw new Error('Nenhum Edge/Chrome encontrado.');

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-smoke-'));
// Coleção limpa, mas o cache de buscas e lojas é o de verdade: o teste não martela os sites de novo.
if (existsSync('data/cache')) cpSync('data/cache', path.join(dataDir, 'cache'), { recursive: true });
const BACKEND = process.argv.includes('--backend=postgres') ? 'postgres' : 'json';
const backendEnv = { STORAGE_BACKEND: BACKEND, DATABASE_URL: '' };
if (BACKEND === 'postgres') {
  // Mesma coleção limpa, migrations versionadas e importação verificada, antes de o servidor subir.
  const prep = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/smoke-prepare-pg.ts', dataDir], { stdio: 'inherit', env: { ...process.env, LOG_LEVEL: 'warn' } });
  if (prep.status !== 0) throw new Error('Não consegui preparar o banco do smoke.');
  backendEnv.DATABASE_URL = `pglite:${path.join(dataDir, 'pg')}`;
}
console.log(`backend: ${BACKEND}`);
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/server/src/main.ts'], {
  env: { ...process.env, ...backendEnv, PERFUMES_PORT: String(PORT), PERFUMES_DATA_DIR: dataDir, PERFUMES_HOST: '127.0.0.1', PERFUMES_ACCESS_CODE: 'SMOKE1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor não subiu:\n${serverLog}`);
}

const settle = (page, ms = 1400) => page.waitForTimeout(ms);
const accentOf = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim());
const nameOf = (page) => page.locator('.nameplate__name').innerText();

let lastPage = null;
try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors = [];

  /* ------------------------------------------------------------ desktop */
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  lastPage = page;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  // FLUXO 1 — abrir, ver a wishlist povoada, frasco em destaque, atmosfera na cor do frasco
  await page.goto(BASE);
  await page.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await settle(page, 1800);
  const wishCount = await page.locator('.tab').first().locator('.tab__count').innerText();
  check('F1 wishlist povoada pela planilha', wishCount === '14', `contador ${wishCount}`);
  check('F1 primeiro perfume em foco', (await nameOf(page)) === 'SHIYAAKA SNOW' || (await nameOf(page)).toUpperCase() === 'SHIYAAKA SNOW', await nameOf(page));
  const webgl = await page.evaluate(() => Boolean(document.querySelector('.galaxy canvas')));
  check('F1 galáxia em WebGL', webgl);
  await page.screenshot({ path: path.join(REVIEW, 'desktop.png') });

  // FLUXO 2 — trocar de frasco (teclado, arrasto, roda) e a cor acompanha
  const accentBefore = await accentOf(page);
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await settle(page, 2200);
  const eliteName = await nameOf(page);
  const accentElite = await accentOf(page);
  check('F2 setas levam ao 8º perfume', /CLUB DE NUIT ELITE/i.test(eliteName), eliteName);
  check('F2 atmosfera mudou de cor', accentElite !== accentBefore, `${accentBefore} → ${accentElite}`);
  const [r, g, b] = accentElite.split(/\s+/).map(Number);
  check('F2 sotaque verde para frasco verde', g > r && g > b, accentElite);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-elite.png') });

  const box = await page.locator('.stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 12 });
  await page.mouse.up();
  await settle(page, 1800);
  const afterDrag = await nameOf(page);
  check('F2 arrastar troca o perfume', afterDrag !== eliteName, `${eliteName} → ${afterDrag}`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await settle(page, 1600);
  check('F2 roda/trackpad navega', (await nameOf(page)) !== afterDrag, await nameOf(page));

  // FLUXO 3 — o ↗ abre a página original
  const link = page.locator('.nameplate a.icon-link');
  const href = await link.getAttribute('href');
  const target = await link.getAttribute('target');
  const rel = await link.getAttribute('rel');
  check('F3 ícone ↗ aponta para a URL original', /^https:\/\//.test(href ?? '') && target === '_blank' && /noopener/.test(rel ?? ''), href);
  const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
  await link.click();
  const opened = await popup;
  check('F3 clique abre nova aba na loja', Boolean(opened) && (opened.url() === href || opened.url().startsWith(new URL(href).origin) || opened.url() === 'about:blank'), opened?.url());
  await opened?.close();

  // Inspeção
  await page.keyboard.press('Home');
  await settle(page, 1400);
  await page.locator('.slot.is-focus').click({ position: { x: 100, y: 200 } });
  await settle(page, 900);
  check('Close-up abre ao tocar no frasco', await page.locator('.app.is-inspecting').count() === 1);
  // FLUXO 3 (V2) — close-up com perfil olfativo
  await settle(page, 1600);
  const tiers = await page.locator('.closeup .pyramid .tier').count();
  const topNotes = await page.locator('.closeup .tier--0 .note').allInnerTexts();
  check('F3 close-up mostra a pirâmide olfativa', tiers === 3 && topNotes.length > 0, `${tiers} camadas; saída: ${topNotes.join(', ')}`);
  check('F3 fonte das notas citada', (await page.locator('.closeup .sources a').count()) > 0);
  check('F3 sem porcentagens inventadas', !/%/.test(await page.locator('.closeup').innerText()));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-closeup.png') });
  await page.keyboard.press('Escape');
  await settle(page, 700);
  check('Esc sai do close-up', await page.locator('.app.is-inspecting').count() === 0);
  await page.getByRole('button', { name: /Perfil olfativo/ }).click();
  await settle(page, 600);
  check('Botão "Perfil olfativo" abre o close-up', await page.locator('.closeup').count() === 1);
  await page.keyboard.press('Escape');
  await settle(page, 700);

  // FLUXO 4 — adicionar por link
  await page.getByRole('button', { name: 'Adicionar perfume' }).click();
  await page.locator('.sheet input[type="url"]').fill(IMPORT_URL);
  await settle(page, 800);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-add-link.png') });
  await page.locator('.sheet button[type="submit"]').click();
  await page.waitForSelector('.analyzing__text', { timeout: 5000 }).catch(() => null);
  await settle(page, 600);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-add-analyzing.png') });
  const stagesSeen = new Set();
  const watchStages = setInterval(() => page.locator('.analyzing__text').innerText({ timeout: 200 }).then((t) => stagesSeen.add(t.trim())).catch(() => {}), 150);
  // Confiança alta: entra direto (a folha fecha). Moderada: prévia "é este?".
  await page.waitForFunction(() => !document.querySelector('.sheet') || document.querySelector('.preview, .unidentified'), null, { timeout: 180000 });
  clearInterval(watchStages);
  check('F4 etapas mostradas na ordem do produto', [...stagesSeen].some((t) => /IDENTIFICANDO|ANALISANDO O LINK|PESQUISANDO O PRODUTO/i.test(t)) && [...stagesSeen].some((t) => /IMAGEM|FRASCO|OLFATIVO|FINALIZANDO/i.test(t)), [...stagesSeen].join(' → '));
  let importedName;
  if (await page.locator('.preview').count()) {
    await settle(page, 1200);
    importedName = await page.locator('.preview__name').innerText();
    const hasImage = await page.locator('.preview__bottle img').count();
    const previewNotes = await page.locator('.preview__notes dd').count();
    check('F4 só o link: nome, foto e notas encontrados sozinhos (prévia)', importedName.length > 1 && hasImage === 1 && previewNotes > 0, `nome “${importedName}”, foto ${hasImage ? 'sim' : 'não'}, camadas de notas ${previewNotes}`);
    check('F4 nenhum campo para digitar na prévia', (await page.locator('.preview input').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-add-review.png') });
    await page.getByRole('button', { name: 'Adicionar à wishlist' }).click();
    await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
  } else {
    check('F4 identidade confirmada: entrou direto, sem perguntar nada', (await page.locator('.unidentified').count()) === 0);
  }
  await settle(page, 1600);
  importedName ??= await nameOf(page);
  const stored = await page.evaluate(async () => (await (await fetch('api/perfumes')).json()).perfumes.find((p) => p.origin === 'url-import'));
  check('F4 foto no quadro padrão (PNG mestre + webp quadrado)', Boolean(stored?.masterUrl && stored?.imageUrl), `${stored?.masterUrl} · ${stored?.imageUrl}`);
  check('F4 origem de cada campo guardada', Boolean(stored?.fieldSources?.name && stored?.fieldSources?.image), Object.keys(stored?.fieldSources ?? {}).join(', '));
  check('F4 perfil olfativo com fonte', Boolean(stored?.olfactoryProfile?.sources?.length), stored?.olfactoryProfile?.source);
  check('F4 link original guardado para o ↗', stored?.sourceUrl === IMPORT_URL, stored?.sourceUrl);
  const square = await page.evaluate(() => {
    const img = document.querySelector('.slot.is-focus .bottle__img');
    return img ? img.naturalWidth === img.naturalHeight && img.closest('[data-canvas]')?.getAttribute('data-canvas') : null;
  });
  check('F4 frasco novo no quadro quadrado do palco', square === 'square', String(square));
  check('F4 perfume entrou na wishlist', (await page.locator('.tab').first().locator('.tab__count').innerText()) === '15');
  check('F4 perfume novo em foco', (await nameOf(page)).toLowerCase().includes(importedName.toLowerCase().slice(0, 6)), await nameOf(page));

  // Duplicata
  await page.getByRole('button', { name: 'Adicionar perfume' }).click();
  await page.locator('.sheet input[type="url"]').fill(IMPORT_URL);
  await page.locator('.sheet button[type="submit"]').click();
  await settle(page, 600);
  check('Duplicata detectada pelo link', (await page.locator('.sheet__notice').innerText().catch(() => '')).includes('já é de'));
  await page.keyboard.press('Escape');
  await settle(page, 500);

  // Link inválido
  await page.getByRole('button', { name: 'Adicionar perfume' }).click();
  await page.locator('.sheet input[type="url"]').fill('isso não é um link');
  await page.locator('.sheet button[type="submit"]').click();
  check('Link inválido explicado sem erro técnico', /não parece um link/.test(await page.locator('.sheet__error').innerText()));
  await page.keyboard.press('Escape');
  await settle(page, 500);

  // VARIANTES (a) — produto com 50 ml e 100 ml: pergunta ANTES de pesquisar, com o frasco de cada versão.
  await page.getByRole('button', { name: 'Adicionar perfume' }).first().click();
  await page.locator('.sheet input[type="url"]').fill('https://officialmykonos.com/products/mykonos-reflection-extrait-de-parfum-50ml-100ml');
  await page.locator('.sheet button[type="submit"]').click();
  await page.waitForSelector('.variants', { timeout: 120000 });
  await settle(page, 800);
  const cards = await page.locator('.variant').count();
  const thumbs = await page.locator('.variant__art img').count();
  const sizes = await page.locator('.variant__size').allInnerTexts();
  const preChecked = await page.locator('.variant input:checked').count();
  check('Variantes: pergunta qual versão, com o frasco de cada uma', cards === 2 && thumbs === 2 && sizes.join('|').includes('50') && sizes.join('|').includes('100'), `${cards} cartões, ${thumbs} fotos: ${sizes.join(' / ')}`);
  check('Variantes: sem escolha no link, nada vem pré-selecionado', preChecked === 0 && (await page.locator('.variants button[type="submit"]').isDisabled()));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-variants.png') });
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.keyboard.press('Escape');
  await settle(page, 500);

  // VARIANTES (b) — perfume antigo "50/100 ml": o app oferece escolher; escolhido, vira UMA variante inteira.
  await page.keyboard.press('Home');
  await settle(page, 900);
  for (let i = 0; i < 16 && !/EMPIRE/i.test(await nameOf(page)); i++) {
    await page.keyboard.press('ArrowRight');
    await settle(page, 350);
  }
  const offer = page.getByRole('button', { name: 'Escolher versão' });
  check('Variantes: perfume sem versão escolhida oferece "Escolher versão"', (await offer.count()) === 1, await nameOf(page));
  if (await offer.count()) {
    await offer.click();
    await page.waitForSelector('.sheet--variant .variant', { timeout: 120000 });
    await page.locator('.sheet--variant .variant', { hasText: '50' }).first().click();
    await page.locator('.sheet--variant button[type="submit"]').click();
    await page.waitForFunction(() => /50 ml/.test(document.querySelector('.nameplate__meta')?.textContent ?? '') && !document.querySelector('.sheet--variant'), null, { timeout: 240000 });
    await settle(page, 1500);
    const empire = await page.evaluate(async () => (await (await fetch('api/perfumes')).json()).perfumes.find((p) => /empire/i.test(p.name)));
    const chosen = empire.variants.find((v) => v.id === empire.selectedVariantId);
    check(
      'Variantes: tamanho, preço, link e foto são da MESMA variante',
      empire.volume === '50 ml' && chosen?.volume === '50 ml' && empire.price === chosen?.price && (empire.variantUrl ?? '').includes(`variant=${chosen?.id}`) && /media\//.test(empire.imageUrl),
      `${empire.volume} · ${empire.price} ${empire.currency} · ${empire.variantUrl} · ${empire.imageSource?.label}`,
    );
    await page.screenshot({ path: path.join(SHOTS, 'desktop-empire-50.png') });
  }

  // PWA: manifest com o tipo certo, ícones, service worker registrado (localhost é contexto seguro).
  const manifest = await page.evaluate(async () => {
    const r = await fetch('/manifest.webmanifest');
    return { type: r.headers.get('content-type'), body: await r.json() };
  });
  const icons = await page.evaluate(async () => Promise.all(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'].map(async (u) => (await fetch(u)).status)));
  check('PWA: manifest instalável (nome, ícones 192/512/maskable, standalone)', /manifest\+json/.test(manifest.type ?? '') && manifest.body.display === 'standalone' && icons.every((s) => s === 200), `${manifest.type} · ícones ${icons.join('/')}`);
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? (reg.active ?? reg.installing ?? reg.waiting)?.scriptURL ?? 'registrando' : null;
  });
  check('PWA: service worker registrado no app servido', Boolean(sw), String(sw));

  // URL PÚBLICA: tudo nasce privado; aberta a wishlist, /username/wishlist mostra o mesmo palco, só leitura.
  const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user);
  check('Perfil: usuário dono com username e tudo privado', /^[a-z0-9._]+$/.test(me.username) && me.privacy.wishlist === 'private' && me.privacy.collection === 'private', `${me.username} · ${JSON.stringify(me.privacy)}`);
  // Conferido fora da página (um 404 dentro dela vira erro no console, que o teste também cobra).
  const closed = (await fetch(`${BASE}/api/public/${me.username}/wishlist`)).status;
  check('Público: lista privada responde 404', closed === 404, String(closed));
  await page.evaluate(async () => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacy: { wishlist: 'public' } }) }));
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await visitor.newPage();
  const pubErrors = [];
  pub.on('pageerror', (e) => pubErrors.push(e.message));
  const pubResponse = await pub.goto(`${BASE}/${me.username}/wishlist`);
  await pub.waitForSelector('.nameplate__name', { timeout: 20000 });
  await settle(pub, 1200);
  const pubTitle = await pub.title();
  const og = await pub.locator('meta[property="og:image"]').getAttribute('content');
  const wordmark = await pub.locator('.wordmark').innerText();
  const editing = await pub.locator('.add-button, .action, [aria-label="Mais opções"]').count();
  check('Público: /username/wishlist com o mesmo palco, só leitura', pubResponse.status() === 200 && editing === 0 && wordmark.toUpperCase() === me.displayName.toUpperCase(), `${pubResponse.status()} · "${wordmark}" · ${editing} controles de edição`);
  check('Público: título e prévia (Open Graph) da página', /Wishlist de/.test(pubTitle) && /^http.*\/(bottles|media)\//.test(og ?? ''), `${pubTitle} · ${og}`);
  await pub.screenshot({ path: path.join(SHOTS, 'public-wishlist.png') });
  const colPage = await pub.goto(`${BASE}/${me.username}/collection`);
  await settle(pub, 1500);
  check('Público: coleção privada não aparece', colPage.status() === 404 && /não é pública/i.test(await pub.locator('.empty__title').innerText()), await pub.locator('.empty__title').innerText());
  check('Público: sem erros de script', pubErrors.length === 0, pubErrors.slice(0, 2).join(' | '));
  await visitor.close();
  await page.evaluate(async () => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacy: { wishlist: 'private' } }) }));

  // Remover com "Desfazer": some na hora, volta inteiro, e só sai de verdade quando o aviso expira.
  const wishCountOf = async () => page.locator('.tab').first().locator('.tab__count').innerText();
  const countBefore = await wishCountOf();
  const removedName = await nameOf(page);
  await page.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: /^Remover/ }).click();
  await page.getByRole('menuitem', { name: /Confirmar remoção/ }).click();
  await settle(page, 1000);
  const countDuring = await wishCountOf();
  await page.locator('.toast').hover();
  await page.waitForTimeout(7500);
  const toastHeld = await page.locator('.toast__action').isVisible();
  check('Aviso para enquanto o ponteiro está em cima', toastHeld);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await settle(page, 1200);
  const storedAfterUndo = await page.evaluate(async () => (await (await fetch('api/perfumes')).json()).perfumes.length);
  check('Remover some na hora e "Desfazer" traz de volta', Number(countDuring) === Number(countBefore) - 1 && (await wishCountOf()) === countBefore && (await nameOf(page)) === removedName, `${countBefore} → ${countDuring} → ${await wishCountOf()} (${removedName})`);
  check('Desfazer não chegou a apagar no servidor', storedAfterUndo === Number(countBefore), `${storedAfterUndo} guardados`);

  // FLUXO 5 — wishlist → coleção
  await page.keyboard.press('Home');
  await settle(page, 1500);
  const buying = await nameOf(page);
  await page.getByRole('button', { name: /Comprei/ }).click();
  await settle(page, 1800);
  check('F5 contador da coleção sobe', (await page.locator('.tab').nth(1).locator('.tab__count').innerText()) === '1');
  check('F5 wishlist volta a 14', (await page.locator('.tab').first().locator('.tab__count').innerText()) === '14');

  // FLUXO 6 — coleção com o mesmo palco + veredito
  await page.getByRole('tab', { name: /Coleção/ }).click();
  await settle(page, 1600);
  check('F6 coleção mostra o perfume comprado', (await nameOf(page)) === buying, buying);
  await page.getByRole('radio', { name: 'Muito bom' }).click();
  await settle(page, 900);
  check('F6 veredito vira carimbo', (await page.locator('.stamp__word').innerText()).toLowerCase() === 'muito bom');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-collection.png') });

  // FLUXO 7 — filtrar
  await page.getByRole('button', { name: /^Bom/ }).click();
  await settle(page, 900);
  check('F7 filtro sem resultados mostra estado vazio', (await page.locator('.empty__title').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-filter-empty.png') });
  await page.getByRole('button', { name: /^Muito bom/ }).click();
  await settle(page, 1200);
  check('F7 filtro “Muito bom” mostra só ele', (await page.locator('.slot').count()) === 1 && (await nameOf(page)) === buying);

  // Persistência: recarrega e confere
  await page.reload();
  await page.waitForSelector('.tab', { timeout: 10000 });
  await settle(page, 1500);
  check('Persistência depois de recarregar', (await page.locator('.tab').nth(1).locator('.tab__count').innerText()) === '1');

  /* ------------------------------------------------------------ celular */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  m.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await m.goto(BASE);
  await m.evaluate(() => localStorage.setItem('perfume-collection.view', 'wishlist'));
  await m.reload();
  await m.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await settle(m, 1800);
  await m.screenshot({ path: path.join(REVIEW, 'mobile.png') });
  const firstMobile = await nameOf(m);
  // Deslizar o dedo (eventos de toque viram pointer events)
  const sb = await m.locator('.stage').boundingBox();
  const cdp = await mobile.newCDPSession(m);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', sb.width * 0.8, sb.height * 0.35);
  for (let i = 1; i <= 10; i++) await touch('touchMove', sb.width * (0.8 - i * 0.05), sb.height * 0.35);
  await touch('touchEnd', 0, 0);
  await settle(m, 1800);
  check('Celular: deslizar troca o perfume', (await nameOf(m)) !== firstMobile, `${firstMobile} → ${await nameOf(m)}`);
  await m.screenshot({ path: path.join(SHOTS, 'mobile-swipe.png') });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('Celular: sem rolagem horizontal', !overflow);
  const hudBox = await m.locator('.hud').boundingBox();
  const bottleBox = await m.locator('.slot.is-focus').boundingBox();
  check('Celular: frasco não fica sob a placa', bottleBox.y + bottleBox.height <= hudBox.y + 40, `frasco até ${Math.round(bottleBox.y + bottleBox.height)}, placa desde ${Math.round(hudBox.y)}`);
  // Alvos de toque: todo controle visível com pelo menos 44 pt no menor lado (o que mede menos é listado).
  const small = await m.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role="tab"], input, select')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && !el.closest('[inert], .sr-only') && r.bottom > 0 && r.top < innerHeight;
      })
      .map((el) => ({ label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
      .filter((b) => Math.min(b.h, b.w) < 44),
  );
  check('Celular: todos os controles com alvo de 44 pt', small.length === 0, small.map((b) => `${b.label} ${b.w}×${b.h}`).join(', '));
  await m.getByRole('button', { name: 'Adicionar perfume' }).click();
  await settle(m, 700);
  await m.screenshot({ path: path.join(SHOTS, 'mobile-add.png') });
  await m.keyboard.press('Escape');
  await m.getByRole('tab', { name: /Coleção/ }).click();
  await settle(m, 1500);
  await m.screenshot({ path: path.join(SHOTS, 'mobile-collection.png') });
  await m.getByRole('tab', { name: /Wishlist/ }).click();
  await settle(m, 1200);
  await m.getByRole('button', { name: /Perfil olfativo/ }).click();
  await settle(m, 2200);
  await m.screenshot({ path: path.join(SHOTS, 'mobile-closeup.png') });
  const closeBox = await m.locator('.closeup').boundingBox();
  const bottleUp = await m.locator('.slot.is-focus').boundingBox();
  check('Celular: close-up empilhado (frasco em cima, perfil embaixo)', Boolean(closeBox && bottleUp && bottleUp.y + bottleUp.height * 0.6 < closeBox.y + 60), `frasco até ${Math.round((bottleUp?.y ?? 0) + (bottleUp?.height ?? 0))}, perfil desde ${Math.round(closeBox?.y ?? 0)}`);
  await m.keyboard.press('Escape');

  const land = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const l = await land.newPage();
  await l.goto(BASE);
  await l.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await settle(l, 1500);
  await l.screenshot({ path: path.join(SHOTS, 'mobile-landscape.png') });

  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  const t = await tablet.newPage();
  await t.goto(BASE);
  await t.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await settle(t, 1500);
  await t.screenshot({ path: path.join(SHOTS, 'tablet.png') });

  const big = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const bg = await big.newPage();
  await bg.goto(BASE);
  await bg.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await settle(bg, 1500);
  await bg.screenshot({ path: path.join(SHOTS, 'large-2560.png') });

  const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const c = await calm.newPage();
  await c.goto(BASE);
  await c.waitForSelector('.slot.is-focus .bottle__art[data-loaded="true"]', { timeout: 15000 });
  await c.keyboard.press('ArrowRight');
  await c.waitForTimeout(250);
  check('Movimento reduzido: troca sem animação', /SUPREMACY/i.test(await nameOf(c)), await nameOf(c));

  check('Nenhum erro de script no navegador', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (error) {
  check('Execução do teste', false, error.message.split('\n')[0]);
  console.error(error);
  // Evidência da falha: como a página estava e o fim do log do servidor.
  await lastPage?.screenshot({ path: path.join(SHOTS, 'falha.png') }).catch(() => {});
  console.error(`--- servidor (fim do log) ---\n${serverLog.split('\n').slice(-25).join('\n')}`);
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok. Capturas em .impeccable/review/ e scripts/.shots/`);
process.exit(failed.length ? 1 : 0);
