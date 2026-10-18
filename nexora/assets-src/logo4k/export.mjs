// Exporte le logo reconstruit (out/) : fichiers 4K livrables (brand/) et fichiers du site (public/brand/).
//   node assets-src/logo4k/export.mjs        (après trace.py, rasterize.mjs et compose.py)
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'assets-src/logo4k/out/';
const SITE = 'public/brand/';
const DELIV = 'brand/';
mkdirSync(DELIV, { recursive: true });
const N = 3840;
const K = N / 1254;
const paths = JSON.parse(readFileSync(`${OUT}symbol-paths.json`, 'utf8'));
const WHITE = '#EAE6E8';
const BLACK = '#09090C';

// Coordonnées SVG arrondies à 0,01 px : 40 % plus léger, sans écart visible même en 4K.
const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100));

// ---------------------------------------------------------------- symbole : recadrage sur la forme (+ marge)
const symbol4k = sharp(`${OUT}nexora-symbol-${N}.png`);
const { info } = await symbol4k.clone().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const pad = Math.round(8 * K);
const box = {
  left: Math.max(0, -info.trimOffsetLeft - pad),
  top: Math.max(0, -info.trimOffsetTop - pad),
};
box.width = Math.min(N - box.left, info.width + 2 * pad);
box.height = Math.min(N - box.top, info.height + 2 * pad);
const cropped = await symbol4k.clone().extract(box).png().toBuffer();
// Même cadre en coordonnées du fichier d'origine (pour les masques vectoriels).
const vb = [box.left / K, box.top / K, box.width / K, box.height / K].map((v) => Math.round(v * 100) / 100).join(' ');
console.log('symbole recadré', box, 'viewBox', vb);

// Livrable : symbole 4K (plus grand côté = 3840 px), fond transparent.
const scale4k = N / Math.max(box.width, box.height);
await sharp(cropped)
  .resize(Math.round(box.width * scale4k), Math.round(box.height * scale4k), { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(`${DELIV}nexora-symbole-4k.png`);

// Site : variantes responsives AVIF + WebP.
const widths = [96, 192, 320, 480, 640, 960, 1280, 1600];
for (const w of widths) {
  const r = sharp(cropped).resize(w, null, { kernel: 'lanczos3' });
  await r.clone().webp({ quality: 92, alphaQuality: 100, smartSubsample: true, effort: 6 }).toFile(`${SITE}symbol-${w}.webp`);
  await r.clone().avif({ quality: 70, effort: 7, chromaSubsampling: '4:4:4' }).toFile(`${SITE}symbol-${w}.avif`);
}

// Masques vectoriels (bande vin = néon) et silhouettes monochromes.
const svgPath = (d, viewBox, fill, extra = '', rule = 'evenodd') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}><path fill="${fill}" fill-rule="${rule}" d="${round(d)}"/></svg>`;
writeFileSync(`${SITE}symbol-wine.svg`, svgPath(paths.wine, vb, '#fff', ' preserveAspectRatio="none"'));
writeFileSync(`${DELIV}nexora-symbole-silhouette.svg`, svgPath(paths.silhouette, vb, WHITE));

// ---------------------------------------------------------------- logotype
// Logotype redessiné en géométrie exacte (wordmark.py). Livrables et verrouillages : repère du bandeau.
const wm = paths.wordmark;
const wordmarkSvg = (fill) => svgPath(wm.d, `0 0 ${wm.width} ${wm.height}`, fill, '', 'nonzero');
// Site : grille de dessin (capitale 19, graisse 3) avec 1 unité de marge ; affiché à 133 × 22 px dans l'en-tête,
// soit 1 unité = 1 px : fûts et barres alignés sur les pixels, aucun bord flou.
const geo = JSON.parse(readFileSync(`${OUT}wordmark-geometry.json`, 'utf8'));
const wmW = Math.ceil(geo.width) + 2;
writeFileSync(`${SITE}wordmark.svg`, svgPath(geo.d, `-1 -1 ${wmW} 22`, WHITE, ` width="${wmW}" height="22"`, 'nonzero'));
console.log('logotype du site', wmW, '× 22');
writeFileSync(`${DELIV}nexora-logotype.svg`, wordmarkSvg(WHITE));
writeFileSync(`${DELIV}nexora-logotype-noir.svg`, wordmarkSvg(BLACK));

// ---------------------------------------------------------------- verrouillage symbole + logotype (disposition du bandeau)
// Disposition mesurée sur le bandeau (px du bandeau) : symbole = silhouette HD recalée sur la bande vin du bandeau,
// logotype = boîte du tracé (marge de 6 px comprise).
const bannerSym = [275, 302, 553, 600];
const bannerWm = paths.banner.wordmark_box; // [595, 384, 1462, 527]
const ratio = (bannerWm[3] - bannerWm[1]) / (bannerSym[3] - bannerSym[1]);
const gapRatio = (bannerWm[0] - bannerSym[2]) / (bannerSym[3] - bannerSym[1]);
const centerRatio = ((bannerWm[1] + bannerWm[3]) / 2 - bannerSym[1]) / (bannerSym[3] - bannerSym[1]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const symbolUri = `data:image/png;base64,${cropped.toString('base64')}`;

async function lockup({ width, height, symbolHeight, background, out, jpeg }) {
  const sh = symbolHeight;
  const sw = (sh * box.width) / box.height;
  const wh = sh * ratio;
  const ww = (wh * wm.width) / wm.height;
  const gap = sh * gapRatio;
  const total = sw + gap + ww;
  const W = width ?? Math.ceil(total);
  const H = height ?? Math.ceil(sh);
  const x0 = (W - total) / 2;
  const y0 = (H - sh) / 2;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const bg = background ?? 'transparent';
  await page.setContent(`<style>html,body{margin:0;width:${W}px;height:${H}px;background:${bg};overflow:hidden}
    img,svg{position:absolute;display:block}</style>
    <img src="${symbolUri}" style="left:${x0}px;top:${y0}px;width:${sw}px;height:${sh}px">
    ${wordmarkSvg(WHITE).replace('<svg ', `<svg style="left:${x0 + sw + gap}px;top:${y0 + sh * centerRatio - wh / 2}px;width:${ww}px;height:${wh}px" `)}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const png = await page.screenshot({ omitBackground: !background, type: 'png' });
  await page.close();
  const img = sharp(png);
  if (jpeg) await img.jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  else await img.png({ compressionLevel: 9 }).toFile(out);
}

// Livrables 4K : verrouillage transparent (3840 px de large) et version UHD 3840 × 2160 sur fond noir.
const lockupH = 3840 / (box.width / box.height + gapRatio + (ratio * wm.width) / wm.height);
await lockup({ symbolHeight: lockupH, out: `${DELIV}nexora-logo-4k.png` });
await lockup({ width: 3840, height: 2160, symbolHeight: 2160 * 0.3, background: BLACK, out: `${DELIV}nexora-logo-4k-fond-noir.png` });

// Image de partage (Open Graph) 1200 × 630 : verrouillage net sur fond noir, halo vin discret à gauche.
await lockup({
  width: 1200,
  height: 630,
  symbolHeight: 220,
  background: `radial-gradient(60% 90% at 18% 50%, rgb(117 27 53 / 0.42), transparent 70%), ${BLACK}`,
  out: `${SITE}og-image.jpg`,
  jpeg: true,
});
await browser.close();

// ---------------------------------------------------------------- icônes (symbole centré)
async function icon(size, bg, file, fill = 0.78) {
  const inner = Math.round(size * fill);
  const s = await sharp(cropped).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer();
  const base = sharp({ create: { width: size, height: size, channels: 4, background: bg } });
  const img = base.composite([{ input: s, gravity: 'center' }]).png({ compressionLevel: 9 });
  if (file) await img.toFile(file);
  return img.toBuffer();
}
const dark = { r: 9, g: 9, b: 12, alpha: 1 };
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
await icon(180, dark, `${SITE}apple-touch-icon.png`);
await icon(192, dark, `${SITE}icon-192.png`);
await icon(512, dark, `${SITE}icon-512.png`);
await icon(32, clear, `${SITE}favicon-32.png`, 0.92);
// favicon.ico (PNG 32 px encapsulé : format accepté par tous les navigateurs actuels).
const png32 = await icon(32, clear, null, 0.92);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(`${SITE}favicon.ico`, Buffer.concat([ico, png32]));
// Copie à la racine : servie telle quelle par un CDN (Netlify) sans passer par l'application.
writeFileSync('public/favicon.ico', Buffer.concat([ico, png32]));
console.log('ok : brand/ (4K) et public/brand/ (site)');
