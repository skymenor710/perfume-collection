/**
 * Os sete tipos de link do pedido, pelo resolvedor inteiro (o mesmo do botão "Adicionar perfume").
 * Para cada um: identidade, confiança, marca, concentração, preço (com a origem), foto (origem, método,
 * transparência e posição no quadro), perfil olfativo, cor da galáxia. Folha de conferência em
 * scripts/.shots/url-kinds.png. Uso: npx tsx scripts/url-kinds.ts [número…]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { BOTTLE_CANVAS } from '@perfumes/core/canvas';
import { accentHexes } from '../apps/server/src/import/pipeline';
import { resolveProduct } from '../apps/server/src/resolver/resolve';

const KINDS: { kind: string; url: string }[] = [
  { kind: 'revendedora que abre', url: 'https://royaloudleicester.com/products/rasasi-hawas-fire-eau-de-parfum-100ml' },
  { kind: 'revendedora que bloqueia', url: 'https://www.notino.fr/dior/sauvage-eau-de-parfum-pour-homme/p-15676518/' },
  { kind: 'link difícil (só código da loja)', url: 'https://www.sephora.fr/p/good-girl---eau-de-parfum-P3372018.html' },
  { kind: 'rastreadores no link', url: 'https://www.arabicparfums.com/products/lattafa-khamrah-eau-de-parfum-100ml?utm_source=facebook&utm_medium=paid&fbclid=IwAR0xYz123&gclid=Cj0KCQ' },
  { kind: 'slug longo', url: 'https://www.parfumdreams.fr/Lattafa/Asad-Eau-de-Parfum-Spray-100-ml-pour-homme-oriental-epice-ambre-vanille/index_97112.aspx' },
  { kind: 'nome claramente no link', url: 'https://www.amazon.fr/Armaf-Club-Nuit-Intense-Toilette/dp/B01M0BV1ZV/ref=sr_1_3?keywords=club+de+nuit' },
  { kind: 'nome só em parte', url: 'https://www.notino.fr/armaf/cdn-intense-man-edt/' },
];

const only = process.argv.slice(2).map(Number).filter(Boolean);
const SHOTS = path.resolve('scripts/.shots');
mkdirSync(SHOTS, { recursive: true });
const tiles: OverlayOptions[] = [];
const rows: unknown[] = [];

const checker = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#2a2a30"/><rect width="10" height="10" fill="#3a3a42"/><rect x="10" y="10" width="10" height="10" fill="#3a3a42"/></pattern></defs><rect width="300" height="300" fill="url(#c)"/><line x1="0" x2="300" y1="276" y2="276" stroke="#e33"/></svg>`,
  ),
)
  .png()
  .toBuffer();

for (const [i, k] of KINDS.entries()) {
  if (only.length && !only.includes(i + 1)) continue;
  const started = Date.now();
  const stages: string[] = [];
  const outcome = await resolveProduct({ url: k.url }, (s) => stages.at(-1) !== s && stages.push(s));
  const secs = Math.round((Date.now() - started) / 1000);
  if (outcome.ok === 'choose') {
    const lines = outcome.variants.map((v) => `${v.volume ?? v.label} ${v.price ?? '?'} ${v.currency ?? ''}${v.thumb ? ' [foto]' : ''}${v.id === outcome.preselectedId ? ' ← o link escolhe' : ''}`);
    console.log(`\n${i + 1}. ${k.kind} — ESCOLHER VERSÃO (${secs}s): ${outcome.identity.brand} · ${outcome.identity.name}\n   ${lines.join('\n   ')}`);
    rows.push({ kind: k.kind, url: k.url, ok: 'choose', identity: outcome.identity, preselectedId: outcome.preselectedId, variants: outcome.variants.map(({ thumb, ...v }) => ({ ...v, thumb: Boolean(thumb) })) });
    continue;
  }
  if (!outcome.ok) {
    console.log(`\n${i + 1}. ${k.kind} — NÃO IDENTIFICADO (${secs}s)\n   ${outcome.message}\n   palpite: ${JSON.stringify(outcome.guess)}\n   ${outcome.evidence.join('\n   ')}`);
    rows.push({ kind: k.kind, url: k.url, ok: false, guess: outcome.guess, evidence: outcome.evidence });
    continue;
  }
  const p = outcome.product;
  let alpha = null as null | { transparentCorners: boolean; baseRow: number; heightShare: number };
  if (p.image) {
    const { data, info } = await sharp(p.image.bottle.master).raw().toBuffer({ resolveWithObject: true });
    const a = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    let top = info.height;
    let bottom = 0;
    for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 8) if (a(x, y) > 128) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    alpha = { transparentCorners: [a(0, 0), a(info.width - 1, 0), a(0, info.height - 1), a(info.width - 1, info.height - 1)].every((v) => v === 0), baseRow: bottom / info.height, heightShare: (bottom - top) / info.height };
    tiles.push({ input: await sharp(checker).composite([{ input: await sharp(p.image.bottle.large).resize(300, 300).toBuffer() }]).png().toBuffer(), left: tiles.length * 310 + 5, top: 5 });
  }
  const accent = accentHexes(p.image?.bottle.color.hex ?? null);
  const row = {
    kind: k.kind,
    url: k.url,
    ok: true,
    secs,
    stages: stages.join(' → '),
    identity: p.identity,
    confidence: `${Math.round(p.confidence * 100)}% (${p.level})`,
    pageBlocked: p.pageBlocked,
    price: p.price,
    image: p.image ? { origin: p.image.candidate.origin, from: p.image.candidate.label, method: p.image.bottle.method, score: Math.round(p.image.score), ...alpha } : null,
    notes: p.olfactoryProfile ? { source: p.olfactoryProfile.source, top: p.olfactoryProfile.topNotes.length, heart: p.olfactoryProfile.heartNotes.length, base: p.olfactoryProfile.baseNotes.length, flat: p.olfactoryProfile.notes.length } : null,
    color: p.image?.bottle.color.hex ?? null,
    accent: accent.accentColor,
    fieldSources: Object.fromEntries(Object.entries(p.fieldSources).map(([key, fsrc]) => [key, `${fsrc.kind}: ${fsrc.label}`])),
    variant: p.variant ? `${p.variant.volume ?? p.variant.label} (${p.variants.length} variantes)` : null,
  };
  rows.push(row);
  console.log(`\n${i + 1}. ${k.kind} (${secs}s)\n${JSON.stringify(row, null, 2)}`);
}

writeFileSync(path.join(SHOTS, 'url-kinds.json'), `${JSON.stringify(rows, null, 2)}\n`);
if (tiles.length) {
  await sharp({ create: { width: tiles.length * 310 + 10, height: 310, channels: 3, background: '#0b0b0e' } }).composite(tiles).png().toFile(path.join(SHOTS, 'url-kinds.png'));
}
console.log(`\nBase esperada no quadro: ${BOTTLE_CANVAS.baseline}. Folha: scripts/.shots/url-kinds.png`);
