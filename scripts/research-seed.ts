/**
 * Reprocessa a coleção inicial (os da planilha) pelo MESMO resolvedor "produto primeiro" de um perfume novo:
 * link como pista + identidade já conhecida → busca → bases/lojas → fotos → recorte (IA + cor) → quadro
 * quadrado padrão → cor → perfil olfativo. A foto antiga não tem autoridade: é só mais uma candidata.
 *
 * Saída: public/bottles/<id>.<hash>-{lg,sm}.webp (derivados do quadro), assets/masters/<id>.<hash>.png
 * (PNG 2048² transparente, fora do site), src/data/seed.json e scripts/.shots/research-{report.json,sheet.png}.
 * Uso: npm run seed:research
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { ASSET_VERSION, sanitizePerfume, type Perfume } from '../src/core/perfume';
import { accentHexes } from '../server/import/pipeline';
import { resolveProduct } from '../server/resolver/resolve';
import { SEED } from './seed-source';

const ROOT = process.cwd();
const BOTTLES = path.join(ROOT, 'public', 'bottles');
const REPORT = path.join(ROOT, 'scripts', '.shots');
const MASTERS = path.join(ROOT, 'assets', 'masters');
mkdirSync(BOTTLES, { recursive: true });
mkdirSync(MASTERS, { recursive: true });
mkdirSync(REPORT, { recursive: true });

/** Correções manuais de cor, conferidas olhando o frasco (o campo existe para isso). */
/**
 * Variantes escolhidas pela pessoa (a planilha só dizia "50/100 ml"). Mykonos Reflection: 50 ml, pedido explícito
 * em 27/09/2026 — e o link dela (royaloudleicester.com) já vinha com ?variant= do 50 ml. Sem escolha registrada,
 * o perfume guarda as variantes e o app pergunta; nada de adivinhar.
 */
const VARIANT_CHOICES: Record<string, string> = {
  'mykonos-reflection': '58518844047705',
};

/** "50/100 ml": a planilha registrou o produto, não uma variante. */
const multiSize = (volume: string | null) => (volume ?? '').includes('/');

const COLOR_OVERRIDES: Record<string, string> = {
  // Dourado da tampa e do rótulo vence a votação, mas o corpo é um degradê azul-petróleo.
  'khadlaj-island-dreams': '#5f9fb3',
};

const seedPath = path.join(ROOT, 'src', 'data', 'seed.json');
const current = (JSON.parse(readFileSync(seedPath, 'utf8')) as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
const bySheet = new Map(SEED.map((s) => [s.sourceUrl, s]));
const only = process.argv.slice(2);

const report: unknown[] = [];
const CHECKER = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#2a2a30"/><rect width="10" height="10" fill="#3a3a42"/><rect x="10" y="10" width="10" height="10" fill="#3a3a42"/></pattern></defs><rect width="260" height="260" fill="url(#c)"/><line x1="0" x2="260" y1="239" y2="239" stroke="#e33" stroke-width="1"/></svg>`,
  ),
)
  .png()
  .toBuffer();
const out: Perfume[] = [];
const sheet: OverlayOptions[] = [];

for (const [index, p] of current.entries()) {
  if (only.length && !only.includes(p.id)) {
    out.push(p);
    continue;
  }
  const source = p.sourceUrl ? bySheet.get(p.sourceUrl) : undefined;
  const started = Date.now();
  const resolved = await resolveProduct({
    url: p.sourceUrl ?? '',
    identity: { brand: p.brand ?? undefined, name: p.name, concentration: p.concentration, volume: p.variants.length > 1 || multiSize(p.volume) ? null : p.volume },
    // A foto antiga da planilha só entra quando não há variantes (ela pode ser de outro tamanho).
    hintImages: source && !multiSize(p.volume) ? [source.image] : [],
    variantId: VARIANT_CHOICES[p.id] ?? p.selectedVariantId,
  });
  if (resolved.ok === 'choose') {
    // Várias versões e nenhuma escolhida: guarda as variantes e deixa o app perguntar. Foto e preço não mudam.
    const variants = resolved.variants.map(({ thumb: _thumb, image: _image, volumeMl: _ml, attrs: _attrs, ...v }) => v);
    console.log(`${String(index + 1).padStart(2)} ${p.id.padEnd(38)} ESCOLHER VERSÃO: ${resolved.variants.map((v) => v.volume ?? v.label).join(' / ')}`);
    const kept = sanitizePerfume({ ...p, variants, selectedVariantId: null, updatedAt: new Date().toISOString() });
    out.push(kept ?? p);
    report.push({ id: p.id, choose: resolved.variants.map((v) => ({ id: v.id, volume: v.volume, price: v.price, image: v.image })) });
    continue;
  }
  if (!resolved.ok) {
    console.log(`${String(index + 1).padStart(2)} ${p.id.padEnd(38)} NÃO RESOLVIDO: ${resolved.evidence.join(' | ')}`);
    out.push(p);
    report.push({ id: p.id, unresolved: resolved.evidence });
    continue;
  }
  const product = resolved.product;
  const research = { image: product.image, olfactoryProfile: product.olfactoryProfile, gender: product.gender, imageReport: product.imageReport };

  let next: Perfume = { ...p, assetVersion: ASSET_VERSION, updatedAt: new Date().toISOString() };
  // Variante escolhida: tamanho, preço, moeda e link vêm dela, juntos.
  if (product.variant && product.variants.length > 1) {
    const v = product.variant;
    next = {
      ...next,
      variants: product.variants.map(({ image: _i, volumeMl: _m, attrs: _a, ...rest }) => rest),
      selectedVariantId: v.id,
      variantUrl: v.url,
      volume: v.volume ?? next.volume,
      ...(v.price !== null && v.currency ? { price: v.price, currency: v.currency, priceNote: null } : {}),
    };
  }
  if (research.image) {
    const hash = createHash('sha1').update(research.image.bottle.large).digest('hex').slice(0, 8);
    const base = `${p.id}.${hash}`;
    writeFileSync(path.join(BOTTLES, `${base}-lg.webp`), research.image.bottle.large);
    writeFileSync(path.join(BOTTLES, `${base}-sm.webp`), research.image.bottle.small);
    writeFileSync(path.join(MASTERS, `${base}.png`), research.image.bottle.master);
    for (const old of readdirSync(MASTERS)) if (old.startsWith(`${p.id}.`) && old !== `${base}.png`) rmSync(path.join(MASTERS, old));
    const c = research.image.candidate;
    const override = COLOR_OVERRIDES[p.id] ?? null;
    next = {
      ...next,
      imageUrl: `bottles/${base}-lg.webp`,
      thumbUrl: `bottles/${base}-sm.webp`,
      dominantColor: research.image.bottle.color.hex,
      dominantColorOverride: override,
      imageSource: { origin: c.origin, url: c.url, pageUrl: c.pageUrl, label: c.label, score: Math.round(research.image.score) },
      imageCredit: c.label,
      fieldSources: { ...p.fieldSources, ...product.fieldSources },
      ...accentHexes(override ?? research.image.bottle.color.hex),
    };
    // Folha de conferência: quadro inteiro sobre xadrez (transparência visível) — escala e piso comparáveis.
    const tile = await sharp(CHECKER).composite([{ input: await sharp(research.image.bottle.large).resize(260, 260).toBuffer() }]).png().toBuffer();
    sheet.push({ input: tile, left: (index % 5) * 270 + 5, top: Math.floor(index / 5) * 270 + 5 });
  }
  next.olfactoryProfile = research.olfactoryProfile ?? p.olfactoryProfile;
  if (!next.gender && research.gender) next.gender = research.gender;
  const clean = sanitizePerfume(next);
  if (!clean) throw new Error(`Perfume inválido depois da pesquisa: ${p.id}`);
  out.push(clean);

  const prof = clean.olfactoryProfile;
  report.push({
    id: p.id,
    seconds: Math.round((Date.now() - started) / 1000),
    confidence: Math.round(product.confidence * 100),
    identity: product.identity,
    evidence: product.evidence,
    fieldSources: product.fieldSources,
    method: research.image?.bottle.method ?? null,
    chosen: clean.imageSource,
    candidates: research.imageReport,
    notes: prof ? { source: prof.source, top: prof.topNotes, heart: prof.heartNotes, base: prof.baseNotes, flat: prof.notes, accords: prof.mainAccords, year: prof.releaseYear } : null,
  });
  console.log(
    `${String(index + 1).padStart(2)} ${p.id.padEnd(38)} foto: ${clean.imageSource ? `${clean.imageSource.origin} (${clean.imageSource.score})` : 'MANTIDA'}  notas: ${prof?.source ?? '—'}  ${Math.round((Date.now() - started) / 1000)}s`,
  );
}

writeFileSync(seedPath, `${JSON.stringify(out, null, 2)}\n`);
writeFileSync(path.join(REPORT, 'research-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (sheet.length) {
  await sharp({ create: { width: 5 * 270 + 10, height: Math.ceil(current.length / 5) * 270 + 10, channels: 3, background: '#0b0b0e' } })
    .composite(sheet)
    .png()
    .toFile(path.join(REPORT, 'research-sheet.png'));
}

// Fotos que nenhum perfume usa mais saem (as da versão anterior).
const used = new Set(out.flatMap((p) => [p.imageUrl, p.thumbUrl]).filter(Boolean).map((u) => path.basename(u!)));
// A proveniência de cada foto fica num arquivo .json ao lado (embed-prompt); ela sai junto com a foto.
for (const f of readdirSync(BOTTLES)) if (!used.has(f.replace(/\.json$/, ''))) rmSync(path.join(BOTTLES, f));
console.log(`\n${out.length} perfumes → src/data/seed.json (assetVersion ${ASSET_VERSION}). Relatório: scripts/.shots/research-report.json`);
