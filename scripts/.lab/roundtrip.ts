import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fromPerfume, sanitizeLibrary, sanitizeUser, toPerfumeView } from '../../src/core/library';
import { sanitizePerfume, type Perfume } from '../../src/core/perfume';
const raw = JSON.parse(readFileSync('data/perfumes.json', 'utf8'));
const list = (raw.perfumes as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
const user = sanitizeUser({ id: 'u1', username: 'guilherme' })!;
const split = list.map((p) => fromPerfume(p, user.id));
const { library, dropped } = sanitizeLibrary(JSON.parse(JSON.stringify({ users: [user], products: split.map((s) => s.product), entries: split.map((s) => s.entry) })));
let same = 0;
for (const p of list) {
  const e = library.entries.find((x) => x.id === p.id)!;
  const back = toPerfumeView(e, library.products.find((x) => x.id === e.productId)!);
  if (isDeepStrictEqual(back, p)) same++;
  else for (const k of Object.keys(p) as (keyof Perfume)[]) if (!isDeepStrictEqual(back[k], p[k])) console.log('DIFERENTE', p.id, k, JSON.stringify(p[k]).slice(0, 80), '→', JSON.stringify(back[k]).slice(0, 80));
}
console.log(`${same}/${list.length} idênticos depois de migrar e voltar · descartados: ${dropped}`);
