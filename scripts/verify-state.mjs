// Registro e conferência do estado da coleção — roda antes e depois de qualquer mudança estrutural.
//
//   node scripts/verify-state.mjs --save      grava docs/state/baseline.json (o "antes")
//   node scripts/verify-state.mjs             compara o estado atual com o baseline (sai com código 1 se algo mudou)
//
// Lê data/library.json direto (funciona com o servidor parado) e confere cada arquivo de imagem pelo SHA-256.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'docs', 'state', 'baseline.json');

/** Onde uma imagem "bottles/…" ou "media/…" mora no disco (antes e depois da reorganização em apps/). */
function imageFile(ref) {
  if (ref.startsWith('media/')) return path.join(ROOT, 'data', ref);
  const candidates = [path.join(ROOT, 'apps', 'web', 'public', ref), path.join(ROOT, 'public', ref)];
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function snapshot() {
  const lib = JSON.parse(readFileSync(path.join(ROOT, 'data', 'library.json'), 'utf8'));
  const products = new Map(lib.products.map((p) => [p.id, p]));
  const perfumes = lib.entries
    .map((e) => {
      const p = products.get(e.productId);
      const images = (p?.images ?? []).flatMap((i) => [i.url, i.thumbUrl, i.masterUrl].filter(Boolean)).map((ref) => {
        const file = imageFile(ref);
        return { ref, exists: existsSync(file), sha256: existsSync(file) ? sha(file) : null };
      });
      const variant = p?.variants?.find((v) => v.id === e.variantId) ?? null;
      return {
        id: e.id,
        name: p?.name ?? null,
        brand: p?.brand ?? null,
        list: e.list,
        volume: e.volume,
        price: e.price,
        currency: e.currency,
        variantId: e.variantId,
        variantVolume: variant?.volume ?? null,
        variants: (p?.variants ?? []).map((v) => `${v.id}:${v.volume ?? v.label}`),
        rating: e.rating,
        position: e.position,
        sourceUrl: e.sourceUrl,
        images,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: lib.schemaVersion,
    users: lib.users.map((u) => ({ id: u.id, username: u.username, privacy: u.privacy })),
    counts: {
      perfumes: perfumes.length,
      wishlist: perfumes.filter((p) => p.list === 'wishlist').length,
      collection: perfumes.filter((p) => p.list === 'collection').length,
      withVariants: perfumes.filter((p) => p.variants.length > 1).length,
      images: perfumes.reduce((n, p) => n + p.images.length, 0),
      missingImages: perfumes.reduce((n, p) => n + p.images.filter((i) => !i.exists).length, 0),
    },
    perfumes,
  };
}

const now = snapshot();
const reflection = now.perfumes.find((p) => /reflection/i.test(p.name ?? ''));
console.log(
  `perfumes ${now.counts.perfumes} · wishlist ${now.counts.wishlist} · coleção ${now.counts.collection} · com versões ${now.counts.withVariants} · imagens ${now.counts.images} (faltando ${now.counts.missingImages})`,
);
console.log(`Mykonos Reflection: ${reflection ? `${reflection.volume} · variante ${reflection.variantId} (${reflection.variantVolume}) · ${reflection.price} ${reflection.currency}` : 'NÃO ENCONTRADO'}`);

if (process.argv.includes('--save')) {
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify({ savedAt: new Date().toISOString(), ...now }, null, 2)}\n`);
  console.log(`baseline gravado em ${path.relative(ROOT, BASELINE)}`);
  process.exit(now.counts.missingImages === 0 ? 0 : 1);
}

if (!existsSync(BASELINE)) {
  console.error('Sem baseline: rode com --save primeiro.');
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const problems = [];
for (const b of base.perfumes) {
  const n = now.perfumes.find((p) => p.id === b.id);
  if (!n) {
    problems.push(`SUMIU: ${b.id}`);
    continue;
  }
  for (const key of ['name', 'brand', 'list', 'volume', 'price', 'currency', 'variantId', 'rating', 'position', 'sourceUrl']) {
    if (JSON.stringify(b[key]) !== JSON.stringify(n[key])) problems.push(`${b.id}.${key}: ${JSON.stringify(b[key])} → ${JSON.stringify(n[key])}`);
  }
  if (b.variants.join() !== n.variants.join()) problems.push(`${b.id}.variants mudou`);
  for (const img of b.images) {
    const m = n.images.find((i) => i.ref === img.ref);
    if (!m) problems.push(`${b.id}: imagem ${img.ref} saiu do registro`);
    else if (!m.exists) problems.push(`${b.id}: arquivo ${img.ref} não existe`);
    else if (m.sha256 !== img.sha256) problems.push(`${b.id}: arquivo ${img.ref} mudou de conteúdo`);
  }
}
for (const n of now.perfumes) if (!base.perfumes.some((b) => b.id === n.id)) problems.push(`NOVO (não estava no baseline): ${n.id}`);
if (problems.length) {
  console.error(`\n${problems.length} diferença(s) em relação ao baseline de ${base.savedAt}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`idêntico ao baseline de ${base.savedAt}: ${base.counts.perfumes} perfumes, ${base.counts.images} imagens com o mesmo conteúdo.`);
