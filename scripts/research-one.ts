/**
 * Pesquisa um perfume avulso pelo mesmo pipeline e grava o resultado para conferência / envio.
 * Uso: npx tsx scripts/research-one.ts "<marca>" "<nome>" [concentração] [url da página] [pasta de saída]
 * Saída: <pasta>/<slug>-lg.webp, -sm.webp e <slug>.json (foto escolhida, candidatas, perfil olfativo).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { accentHexes } from '../apps/server/src/import/pipeline';
import { researchPerfume } from '../apps/server/src/research/perfume';

const [brand, name, concentration = '', pageUrl = '', outDir = 'scripts/.shots/one'] = process.argv.slice(2);
if (!brand || !name) throw new Error('Uso: research-one "<marca>" "<nome>" [concentração] [url] [pasta]');
mkdirSync(outDir, { recursive: true });
const slug = `${brand}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const r = await researchPerfume({ brand, name, concentration, pageUrl: pageUrl || null });
if (r.image) {
  writeFileSync(path.join(outDir, `${slug}-lg.webp`), r.image.bottle.large);
  writeFileSync(path.join(outDir, `${slug}-sm.webp`), r.image.bottle.small);
}
const c = r.image?.candidate;
const out = {
  database: r.fragrantica?.url ?? null,
  stores: r.stores.map((s) => `${s.official ? 'oficial' : 'revenda'} ${s.product.store}: ${s.product.title}`),
  imageSource: c ? { origin: c.origin, url: c.url, pageUrl: c.pageUrl, label: c.label, score: Math.round(r.image!.score) } : null,
  dominantColor: r.image?.bottle.color.hex ?? null,
  ...accentHexes(r.image?.bottle.color.hex ?? null),
  olfactoryProfile: r.olfactoryProfile,
  gender: r.gender,
  candidates: r.imageReport,
};
writeFileSync(path.join(outDir, `${slug}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ database: out.database, stores: out.stores, imageSource: out.imageSource, notes: out.olfactoryProfile && [out.olfactoryProfile.source, out.olfactoryProfile.topNotes, out.olfactoryProfile.heartNotes, out.olfactoryProfile.baseNotes] }, null, 1));
