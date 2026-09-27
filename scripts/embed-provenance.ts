/**
 * Proveniência de cada foto da semente: um .json ao lado de cada webp em public/bottles (o mesmo formato do
 * `impeccable embed-prompt`), dizendo de onde veio a imagem e o que foi feito nela. Roda depois do seed:research.
 * Uso: npx tsx scripts/embed-provenance.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizePerfume, type Perfume } from '@perfumes/core/perfume';

const ROOT = process.cwd();
const seed = (JSON.parse(readFileSync(path.join(ROOT, 'apps', 'web', 'src', 'data', 'seed.json'), 'utf8')) as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
let written = 0;
for (const p of seed) {
  const s = p.imageSource;
  if (!s) continue;
  const prompt =
    `Origem: foto de produto escolhida automaticamente pelo resolvedor "produto primeiro" (fonte: ${s.label ?? '?'}; ` +
    `imagem ${s.url ?? '?'}; página ${s.pageUrl ?? '?'}; nota de qualidade ${s.score ?? '?'}). ` +
    'Fundo removido por segmentação (BiRefNet-lite, MIT, rodando no próprio computador) combinada com recorte por cor; ' +
    'frasco posto no quadro padrão 2048² transparente (72%×84%, base em 92%) e cor extraída por server/media/process.ts. ' +
    'Nenhum pixel do frasco foi gerado por IA.';
  for (const ref of [p.imageUrl, p.thumbUrl]) {
    if (!ref?.startsWith('bottles/')) continue;
    const file = path.join(ROOT, 'apps', 'web', 'public', `${ref}.json`);
    if (existsSync(file)) continue;
    writeFileSync(file, `${JSON.stringify({ prompt, createdAt: p.updatedAt }, null, 2)}\n`);
    written++;
  }
}
console.log(`${written} arquivos de proveniência gravados.`);
