// Aperçu autonome : enregistre les pages rendues par le serveur (accueil + pages légales) en fichiers HTML autonomes
// (CSS, JS, polices et images intégrés), pour les consulter sans serveur. Le formulaire n'envoie rien (pas de serveur).
//   node scripts/snapshot.mjs [url] [sortie.html] [--artifact]
// --artifact : page d'accueil en fragment pour une page claude.ai (sans <html>/<head>/<body>, titre court) ; les pages
// légales sont écrites à côté (mentions-legales.html, politique-de-confidentialite.html) et reliées par liens relatifs.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const out = process.argv[3] ?? 'docs/nexora-apercu.html';
const artifact = process.argv.includes('--artifact');
const dir = path.dirname(out);
const HOME = artifact ? 'index.html' : path.basename(out);
const LEGAL = { '/mentions-legales': 'mentions-legales.html', '/politique-de-confidentialite': 'politique-de-confidentialite.html' };
const cache = new Map();

async function dataUri(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(base + url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
  const uri = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  cache.set(url, uri);
  return uri;
}
async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

/** Une page du site, autonome : ressources intégrées, liens internes réécrits vers les fichiers de l'aperçu. */
async function page(route) {
  let html = await (await fetch(base + route)).text();
  // Images de projets : sources réduites à 2 variantes WebP (1200 px pour la page, 2400 px pour la visionneuse).
  html = html.replace(/<source type="image\/avif"[^>]*>/g, '');
  html = html.replace(/\sdata-avif="[^"]*"/g, ' data-avif=""');
  html = await replaceAsync(html, /\s(srcset|data-webp)="([^"]*\/media\/[^"]*)"/g, async (_m, attr, set) => {
    const items = set.split(',').map((s) => s.trim().split(' ')).filter(([u]) => /\/(1200|2400)\.webp$/.test(u));
    const parts = await Promise.all(items.map(async ([u, w]) => `${await dataUri(u)} ${w}`));
    return parts.length ? ` ${attr}="${parts.join(', ')}"` : '';
  });
  html = await replaceAsync(html, /(src|data-src)="(\/media\/[0-9a-f-]+\/)(\d+)\.webp"/g, async (_m, attr, prefix, w) => {
    const target = Number(w) <= 480 ? 480 : 1200;
    return `${attr}="${await dataUri(`${prefix}${target}.webp`)}"`;
  });
  // Marque, polices, icônes : chemins absolus du site (HTML et CSS intégré).
  // Symbole du hero : une seule variante (960 px) au lieu du jeu complet, pour un aperçu léger.
  html = html.replace(/<source type="image\/avif" srcset="\/brand\/[^"]*"[^>]*>/g, '').replace(/\ssrcset="\/brand\/symbol-320[^"]*"/g, '');
  html = await replaceAsync(html, /(["'(\s])(\/(?:brand|fonts)\/[^"')\s,]+)/g, async (_m, a, url) => `${a}${await dataUri(url)}`);
  html = await replaceAsync(html, /<script type="module" src="([^"]+)"><\/script>/g, async (_m, src) => {
    const js = await (await fetch(base + src)).text();
    return `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  html = html.replace(/<link rel="(?:manifest|canonical|preload|icon|apple-touch-icon)"[^>]*>/g, '');
  for (const [r, file] of Object.entries(LEGAL)) html = html.replaceAll(`href="${r}"`, `href="${file}"`);
  html = route === '/' ? html.replace(/href="\/(#[^"]*)?"/g, (_m, h) => `href="${h ?? '#accueil'}"`) : html.replace(/href="\/(#[^"]*)?"/g, (_m, h) => `href="${HOME}${h ?? ''}"`);
  html = html.replace('<form class="contact-form"', '<form class="contact-form" data-apercu="1"');
  html = html.replace('<p class="contact-form__hint">', '<p class="contact-form__hint"><b>Aperçu hors ligne :</b> l’envoi ne fonctionne que sur le site en ligne. ');
  return html;
}

let home = await page('/');
if (artifact) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(home)[1];
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(home)[1];
  const style = /<style>[\s\S]*?<\/style>/.exec(head)[0];
  const script = /<script type="module">[\s\S]*?<\/script>/.exec(head)[0];
  const fix = `<style>:root{color-scheme:dark}html,body{background:#09090c}.site-header{top:env(safe-area-inset-top,0px)}</style>`;
  home = `<title>Nexora</title>\n<meta name="description" content="Site de Nexora, création de sites web.">\n${style}\n${fix}\n<script>document.documentElement.lang='fr'</script>\n${body}\n${script}\n`;
}
writeFileSync(out, home);
for (const [route, file] of Object.entries(LEGAL)) writeFileSync(path.join(dir, file), await page(route));
console.log(`${out} : ${(home.length / 1024 / 1024).toFixed(2)} Mo (+ ${Object.values(LEGAL).join(', ')}), ${cache.size} fichiers intégrés`);
