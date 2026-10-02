/**
 * Prepara o material REAL do anúncio (só lê o projeto; nada no app é alterado):
 *  - dados da coleção pela API do app que está rodando (GET /api/perfumes — só leitura);
 *  - mestres PNG 2048² dos frascos (assets/masters e data/media), copiados para src/img;
 *  - fonte Archivo variável (a do app, @fontsource-variable/archivo);
 *  - o GLSL da galáxia, extraído de apps/web/src/gl/galaxy.ts (o mesmo shader do app).
 * Uso: npx tsx ad/meus-perfumes-15s/tools/prepare.mts   (na raiz do projeto, com o app no ar em :3100)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { noteLabel } from '../../../packages/core/src/notes-pt.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const AD = path.resolve(import.meta.dirname, '..');
const SRC = path.join(AD, 'src');
mkdirSync(path.join(SRC, 'img'), { recursive: true });
mkdirSync(path.join(SRC, 'fonts'), { recursive: true });

// 1. Dados reais.
const api = (await (await fetch('http://localhost:3100/api/perfumes')).json()) as { perfumes: Record<string, any>[] };
const byId = new Map(api.perfumes.map((p) => [p.id, p]));

/** Ordem da montagem (curadoria do anúncio): o herói primeiro, depois as cores mais contrastantes. */
const ROSTER = [
  'french-avenue-azzure-aoud-7m3nwa',
  'armaf-club-de-nuit-elite',
  'nusuk-ateeq',
  'khadlaj-island-dreams',
  'rayhaan-cedrus-blanc',
  'french-avenue-spectre-ghost',
  'afnan-9-pm-night-out',
  'mykonos-x-rrq-empire',
  'afnan-supremacy-in-heaven',
  'armaf-club-de-nuit-precieux',
  'maison-asrar-vanguard',
  'khadlaj-shiyaaka-snow',
  'afnan-supremacy-collector-s-edition',
  'afnan-supremacy-not-only-intense',
  'mykonos-reflection-r5rx34',
];

const GENDER: Record<string, string> = { masculine: 'Masculino', feminine: 'Feminino', unisex: 'Unissex' };
const money = (v: number | null, c: string | null) => (v == null ? null : `${c === 'EUR' ? '€' : c} ${v.toFixed(2).replace('.', ',')}`);

const masters = readdirSync(path.join(ROOT, 'assets', 'masters'));
const roster = [];
for (const id of ROSTER) {
  const p = byId.get(id);
  if (!p) throw new Error(`perfume ausente na API: ${id}`);
  // Mestre 2048²: o do banco (importados) ou o da planilha em assets/masters (mesmo hash do webp).
  const hash = /\.([0-9a-f]{8})-lg\.webp$/.exec(p.imageUrl ?? '')?.[1];
  const master = p.masterUrl ? path.join(ROOT, 'data', p.masterUrl) : path.join(ROOT, 'assets', 'masters', masters.find((m) => hash && m.includes(hash))!);
  if (!existsSync(master)) throw new Error(`mestre ausente: ${master}`);
  const file = `${id}.png`;
  const hero = id === ROSTER[0];
  // Herói em resolução cheia; o elenco em 1400 px (sobra para 833 px de quadro no palco).
  await sharp(master).resize(hero ? 2048 : 1400).png({ compressionLevel: 6 }).toFile(path.join(SRC, 'img', file));
  const meta = [p.brand, p.concentration, p.volume, GENDER[p.gender ?? '']].filter(Boolean);
  roster.push({
    id,
    name: p.name,
    brand: p.brand,
    meta,
    price: money(p.price, p.currency),
    accent: p.accentColor,
    img: `img/${file}`,
    sourceUrl: p.sourceUrl,
    origin: p.origin,
    notes: {
      top: (p.olfactoryProfile?.topNotes ?? []).map(noteLabel),
      heart: (p.olfactoryProfile?.heartNotes ?? []).map(noteLabel),
      base: (p.olfactoryProfile?.baseNotes ?? []).map(noteLabel),
    },
  });
}
const counts = { wishlist: api.perfumes.filter((p) => p.status === 'wishlist').length, owned: api.perfumes.filter((p) => p.status === 'owned').length };
writeFileSync(path.join(SRC, 'data.js'), `// Gerado por tools/prepare.mts a partir da API do app (dados reais da coleção). Não editar à mão.\nwindow.AD_DATA = ${JSON.stringify({ counts, roster }, null, 2)};\n`);

// 2. Fonte do app.
for (const f of ['archivo-latin-wdth-normal.woff2', 'archivo-latin-ext-wdth-normal.woff2']) {
  copyFileSync(path.join(ROOT, 'node_modules', '@fontsource-variable', 'archivo', 'files', f), path.join(SRC, 'fonts', f));
}

// 3. Shader real da galáxia.
const galaxy = readFileSync(path.join(ROOT, 'apps', 'web', 'src', 'gl', 'galaxy.ts'), 'utf8');
const shaders: Record<string, string> = {};
for (const m of galaxy.matchAll(/const (\w+_(?:VS|FS)) = `([\s\S]*?)`;/g)) shaders[m[1]!] = m[2]!;
for (const k of ['FULLSCREEN_VS', 'BACKGROUND_FS', 'STARS_VS', 'STARS_FS']) if (!shaders[k]) throw new Error(`shader ${k} não encontrado`);
writeFileSync(
  path.join(SRC, 'galaxy-shaders.js'),
  `// Extraído de apps/web/src/gl/galaxy.ts por tools/prepare.mts — o MESMO GLSL da galáxia do app.\nwindow.GALAXY_SHADERS = ${JSON.stringify(shaders, null, 2)};\n`,
);

console.log(`${roster.length} frascos · wishlist ${counts.wishlist} · coleção ${counts.owned} · shaders: ${Object.keys(shaders).join(', ')}`);
for (const r of roster) console.log(`  ${r.name.padEnd(32)} ${r.accent}  ${r.price}  ${r.meta.join(' · ')}`);
