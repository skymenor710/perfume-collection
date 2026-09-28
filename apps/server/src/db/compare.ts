import type { Library } from '@perfumes/core/library';

/**
 * Comparação determinística de duas bibliotecas (ou duas listas de visões): cada diferença sai com o caminho
 * exato, o valor antigo e o novo. Usuários, produtos e entradas são pareados pelo id (a ordem em que o arquivo ou o
 * banco devolve não importa); dentro de um produto, a ORDEM das versões e das imagens importa e é comparada.
 */

export interface Difference {
  path: string;
  left: unknown;
  right: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepDiff(left: unknown, right: unknown, path = '', out: Difference[] = []): Difference[] {
  if (Object.is(left, right)) return out;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) out.push({ path: `${path}.length`, left: left.length, right: right.length });
    for (let i = 0; i < Math.min(left.length, right.length); i++) deepDiff(left[i], right[i], `${path}[${i}]`, out);
    return out;
  }
  if (isObject(left) && isObject(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (!(key in left)) out.push({ path: `${path}.${key}`, left: undefined, right: right[key] });
      else if (!(key in right)) out.push({ path: `${path}.${key}`, left: left[key], right: undefined });
      else deepDiff(left[key], right[key], `${path}.${key}`, out);
    }
    return out;
  }
  out.push({ path: path || '(raiz)', left, right });
  return out;
}

function byId<T extends { id: string }>(items: readonly T[], label: string, out: Difference[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) out.push({ path: `${label}[${item.id}]`, left: 'duplicado', right: 'duplicado' });
    map.set(item.id, item);
  }
  return map;
}

function diffCollection<T extends { id: string }>(label: string, left: readonly T[], right: readonly T[], out: Difference[]) {
  const a = byId(left, label, out);
  const b = byId(right, label, out);
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const l = a.get(id);
    const r = b.get(id);
    if (!l) out.push({ path: `${label}[${id}]`, left: 'ausente', right: 'presente' });
    else if (!r) out.push({ path: `${label}[${id}]`, left: 'presente', right: 'ausente' });
    else deepDiff(l, r, `${label}[${id}]`, out);
  }
}

/** Biblioteca inteira: usuários, produtos (com versões e imagens em ordem) e entradas — todos os campos. */
export function diffLibraries(left: Library, right: Library): Difference[] {
  const out: Difference[] = [];
  if (left.schemaVersion !== right.schemaVersion) out.push({ path: 'schemaVersion', left: left.schemaVersion, right: right.schemaVersion });
  diffCollection('users', left.users, right.users, out);
  diffCollection('products', left.products, right.products, out);
  diffCollection('entries', left.entries, right.entries, out);
  return out;
}

/** Listas de visões (o que a API entrega), pareadas pelo id; a ordem da lista também é conferida. */
export function diffViews<T extends { id: string }>(left: readonly T[], right: readonly T[]): Difference[] {
  const out: Difference[] = [];
  const order = (l: readonly T[]) => l.map((v) => v.id).join(',');
  if (order(left) !== order(right)) out.push({ path: 'ordem', left: order(left), right: order(right) });
  diffCollection('perfumes', left, right, out);
  return out;
}

export function formatDifferences(diffs: Difference[], limit = 50): string {
  const fmt = (v: unknown) => (v === undefined ? '(sem campo)' : JSON.stringify(v)?.slice(0, 120));
  const lines = diffs.slice(0, limit).map((d) => `  ${d.path}: ${fmt(d.left)} → ${fmt(d.right)}`);
  if (diffs.length > limit) lines.push(`  … e mais ${diffs.length - limit}`);
  return lines.join('\n');
}
