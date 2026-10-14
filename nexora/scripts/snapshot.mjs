// Aperçu autonome : enregistre la page d'accueil rendue par le serveur en UN fichier HTML (CSS, JS, polices et
// images intégrés), pour la consulter sans serveur. Le formulaire de contact n'y fonctionne pas (pas de serveur).
//   node scripts/snapshot.mjs [url] [sortie]
import { writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const out = process.argv[3] ?? 'docs/nexora-apercu.html';
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

let html = await (await fetch(base + '/')).text();

// Images de projets : une seule variante (WebP 800 px) par image, sans srcset.
html = html.replace(/<source type="image\/avif"[^>]*>/g, '');
html = html.replace(/\s(?:data-)?srcset="[^"]*"/g, '');
html = await replaceAsync(html, /(src|data-src)="(\/media\/[0-9a-f-]+\/)(\d+)\.webp"/g, async (_m, attr, prefix, w) => {
  const target = Math.min(800, Number(w) || 800);
  return `${attr}="${await dataUri(`${prefix}${target}.webp`).catch(() => dataUri(`${prefix}${w}.webp`))}"`;
});
// Marque, polices, icônes : chemins absolus du site (HTML et CSS intégré).
html = await replaceAsync(html, /(["'(])(\/(?:brand|fonts)\/[^"')]+)(["')])/g, async (_m, a, url, b) => `${a}${await dataUri(url)}${b}`);
// Script du site intégré (module).
html = await replaceAsync(html, /<script type="module" src="([^"]+)"><\/script>/g, async (_m, src) => {
  const js = await (await fetch(base + src)).text();
  return `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
});
// Liens internes du site : restent sur la page.
html = html.replace(/href="\/#/g, 'href="#').replace(/<link rel="(?:manifest|canonical|preload|icon|apple-touch-icon)"[^>]*>/g, '');
html = html.replace(/<form class="contact-form"/, '<form class="contact-form" data-apercu="1"');
html = html.replace(
  '<p class="contact-form__hint">',
  '<p class="contact-form__hint"><b>Aperçu hors ligne :</b> l’envoi ne fonctionne que sur le site en ligne. ',
);

writeFileSync(out, html);
console.log(`${out} : ${(html.length / 1024 / 1024).toFixed(2)} Mo, ${cache.size} fichiers intégrés`);
