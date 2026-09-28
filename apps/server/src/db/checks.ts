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

  // Checagem explícita pedida pelo dono: Mykonos Reflection = 50 ml (versão, imagem, preço, lista), nunca 100 ml.
  const reflectionBase = baseline.perfumes.find((p) => /reflection/i.test(p.name ?? '') && /mykonos/i.test(p.brand ?? ''));
  const reflection = rows.find((r) => /reflection/i.test(r.p?.name ?? '') && /mykonos/i.test(r.p?.brand ?? ''));
  if (!reflectionBase || !reflection?.p) problems.push('Mykonos Reflection: não encontrado');
  else {
    const { e, p } = reflection;
    const v = p.variants.find((x) => x.id === e.variantId);
    const expect = (label: string, got: unknown, want: unknown) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`Mykonos Reflection ${label}: esperado ${JSON.stringify(want)}, banco ${JSON.stringify(got)}`);
    };
    expect('volume', e.volume, '50 ml');
    expect('versão escolhida', e.variantId, reflectionBase.variantId);
    expect('volume da versão', v?.volume ?? null, '50 ml');
    expect('preço', e.price, reflectionBase.price);
    expect('moeda', e.currency, reflectionBase.currency);
    expect('lista', e.list, reflectionBase.list);
    expect('imagem principal', p.images[0]?.url ?? null, reflectionBase.images[0]?.ref ?? null);
    expect('imagem ligada à versão', p.images[0]?.variantId ?? null, reflectionBase.variantId);
    if (e.volume?.includes('100')) problems.push('Mykonos Reflection: aparece como 100 ml — PARAR');
  }
  return problems;
}
