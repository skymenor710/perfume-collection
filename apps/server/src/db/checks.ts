import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Library } from '@perfumes/core/library';
import { config } from '../config';
import type { ImageResolver } from './importer';

/** "bottles/…" mora no site (apps/web/public); "media/…" nos dados. Nada fora dessas pastas. */
export const resolveImageFile: ImageResolver = (ref) => {
  const roots: [string, string][] = [
    ['bottles/', path.join(config.root, 'apps', 'web', 'public')],
    ['media/', config.dataDir],
  ];
  for (const [prefix, root] of roots) {
    if (!ref.startsWith(prefix)) continue;
    const file = path.resolve(root, ref);
    return file.startsWith(path.resolve(root) + path.sep) ? file : null;
  }
  return null;
};

interface BaselinePerfume {
  id: string;
  name: string | null;
  brand: string | null;
  list: string;
  volume: string | null;
  price: number | null;
  currency: string | null;
  variantId: string | null;
  variantVolume: string | null;
  variants: string[];
  rating: string | null;
  position: number;
  sourceUrl: string | null;
  images: { ref: string; exists: boolean; sha256: string | null }[];
}

export interface Baseline {
  savedAt: string;
  counts: { perfumes: number; wishlist: number; collection: number; images: number; missingImages: number };
  perfumes: BaselinePerfume[];
}

export function readBaseline(file: string): Baseline {
  return JSON.parse(readFileSync(file, 'utf8')) as Baseline;
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * O banco (como Library) contra o baseline gravado ANTES da migração: contagens, cada perfume campo a campo, cada
 * imagem pelo SHA-256 do arquivo, e a checagem explícita do Mykonos Reflection (tem de ser 50 ml, nunca 100 ml).
 * Devolve a lista de problemas (vazia = tudo certo).
 */
export function baselineChecks(baseline: Baseline, library: Library, resolve: ImageResolver = resolveImageFile): string[] {
  const problems: string[] = [];
  const products = new Map(library.products.map((p) => [p.id, p]));
  const rows = library.entries.map((e) => ({ e, p: products.get(e.productId) }));

  const images = rows.reduce((n, { p }) => n + (p?.images ?? []).flatMap((i) => [i.url, i.thumbUrl, i.masterUrl].filter(Boolean)).length, 0);
  const counts = {
    perfumes: rows.length,
    wishlist: rows.filter((r) => r.e.list === 'wishlist').length,
    collection: rows.filter((r) => r.e.list === 'collection').length,
    images,
  };
  for (const key of ['perfumes', 'wishlist', 'collection', 'images'] as const) {
    if (counts[key] !== baseline.counts[key]) problems.push(`contagem ${key}: baseline ${baseline.counts[key]} → banco ${counts[key]}`);
  }

  for (const b of baseline.perfumes) {
    const row = rows.find((r) => r.e.id === b.id);
    if (!row?.p) {
      problems.push(`perfume ${b.id} (${b.name}) sumiu`);
      continue;
    }
    const { e, p } = row;
    const variant = p.variants.find((v) => v.id === e.variantId) ?? null;
    const now: Record<string, unknown> = {
      name: p.name,
      brand: p.brand,
      list: e.list,
      volume: e.volume,
      price: e.price,
      currency: e.currency,
      variantId: e.variantId,
      variantVolume: variant?.volume ?? null,
      variants: p.variants.map((v) => `${v.id}:${v.volume ?? v.label}`),
      rating: e.rating,
      position: e.position,
      sourceUrl: e.sourceUrl,
    };
    for (const [key, value] of Object.entries(now)) {
      if (JSON.stringify(value) !== JSON.stringify(b[key as keyof BaselinePerfume])) problems.push(`${b.id}.${key}: baseline ${JSON.stringify(b[key as keyof BaselinePerfume])} → banco ${JSON.stringify(value)}`);
    }
    const refs = p.images.flatMap((i) => [i.url, i.thumbUrl, i.masterUrl].filter((r): r is string => Boolean(r)));
    for (const img of b.images) {
      if (!refs.includes(img.ref)) {
        problems.push(`${b.id}: imagem ${img.ref} saiu do registro`);
        continue;
      }
      const file = resolve(img.ref);
      if (!file || !existsSync(file)) problems.push(`${b.id}: arquivo ${img.ref} não existe`);
      else if (sha(file) !== img.sha256) problems.push(`${b.id}: arquivo ${img.ref} mudou de conteúdo`);
    }
  }

  // Checagem explícita pedida pelo dono: Mykonos Reflection = 50 ml, com a versão e o id certos, nunca 100 ml.
  const reflectionBase = baseline.perfumes.find((p) => /reflection/i.test(p.name ?? '') && /mykonos/i.test(p.brand ?? ''));
  if (!reflectionBase) problems.push('Mykonos Reflection: não está no baseline');
  problems.push(...reflectionChecks(library, { entryId: reflectionBase?.id ?? null, imageRef: reflectionBase?.images[0]?.ref ?? null }));
  return problems;
}

/**
 * O Mykonos Reflection como o dono confirmou: 50 ml, versão Shopify 58518844047705, 35,95 EUR, na wishlist, com a
 * foto ligada a essa versão. Valores FIXOS (não vêm do baseline): se o baseline estivesse errado, isto ainda pegaria.
 * Opcionalmente confere também o id da entrada/produto e a referência da foto registrados no baseline.
 */
export const REFLECTION_EXPECTED = { variantId: '58518844047705', volume: '50 ml', price: 35.95, currency: 'EUR', list: 'wishlist' } as const;

export function reflectionChecks(library: Library, known: { entryId?: string | null; imageRef?: string | null } = {}): string[] {
  const problems: string[] = [];
  const products = new Map(library.products.map((p) => [p.id, p]));
  const found = library.entries
    .map((e) => ({ e, p: products.get(e.productId) }))
    .filter((r) => /reflection/i.test(r.p?.name ?? '') && /mykonos/i.test(r.p?.brand ?? ''));
  if (found.length !== 1) return [`Mykonos Reflection: esperado 1 registro, encontrado ${found.length}`];
  const { e, p } = found[0]!;
  if (!p) return ['Mykonos Reflection: produto não encontrado'];
  const v = p.variants.find((x) => x.id === e.variantId);
  const want = REFLECTION_EXPECTED;
  const expect = (label: string, got: unknown, wanted: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(wanted)) problems.push(`Mykonos Reflection ${label}: esperado ${JSON.stringify(wanted)}, encontrado ${JSON.stringify(got)}`);
  };
  if (known.entryId) {
    expect('id da entrada', e.id, known.entryId);
    expect('id do produto', p.id, known.entryId);
  }
  expect('versão escolhida (variant ID)', e.variantId, want.variantId);
  expect('versão existe no produto', Boolean(v), true);
  expect('volume da entrada', e.volume, want.volume);
  expect('volume da versão', v?.volume ?? null, want.volume);
  expect('preço', e.price, want.price);
  expect('moeda', e.currency, want.currency);
  expect('preço da versão', v?.price ?? null, want.price);
  expect('lista', e.list, want.list);
  if (known.imageRef) expect('imagem principal', p.images[0]?.url ?? null, known.imageRef);
  expect('imagem ligada à versão', p.images[0]?.variantId ?? null, want.variantId);
  if ([e.volume, v?.volume].some((x) => x?.includes('100'))) problems.push('Mykonos Reflection: aparece como 100 ml — PARAR');
  return problems;
}
