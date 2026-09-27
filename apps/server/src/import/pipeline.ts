import { oklabToRgb, rgbToHex } from '@perfumes/core/color';
import type { OlfactoryProfile } from '@perfumes/core/olfactory';
import type { Gender, ImageSource } from '@perfumes/core/perfume';
import { accentFor } from '@perfumes/core/accent';
import { saveBottleMedia, type SavedMedia } from '../media/store';
import type { VariantInfo } from './variants';
import { resolveProduct, type FieldSource, type Identity, type ResolveStage, type VariantChoice } from '../resolver/resolve';

/**
 * Link colado → perfume pronto, pelo resolvedor "produto primeiro" (apps/server/src/resolver). Este módulo só converte
 * o produto resolvido no formato do app e guarda a foto.
 */

export type ImportStage = ResolveStage | 'done';

export interface ImportedPerfume {
  name: string;
  brand: string;
  description: string | null;
  concentration: string | null;
  volume: string | null;
  gender: Gender | null;
  price: number | null;
  currency: string | null;
  sourceUrl: string;
  media: SavedMedia | null;
  imageCredit: string | null;
  imageSource: ImageSource | null;
  accentColor: string | null;
  accentGlow: string | null;
  olfactoryProfile: OlfactoryProfile | null;
  fieldSources: Record<string, FieldSource>;
  /** A variante real e as outras oferecidas pela loja (para "trocar tamanho" depois). */
  variant: VariantInfo | null;
  variants: VariantInfo[];
  /** Link da loja já com a variante escolhida (é ele que o ↗ abre quando existe). */
  variantUrl: string | null;
  /** high: pode entrar direto; moderate: mostrar a prévia antes. */
  confidence: 'high' | 'moderate';
}

export type ImportOutcome =
  | { ok: true; perfume: ImportedPerfume; notes: string[] }
  | {
      ok: 'choose';
      brand: string;
      name: string;
      concentration: string | null;
      variants: VariantChoice[];
      preselectedId: string | null;
      /** De onde vieram as variantes (a loja do link, ou outra quando ela não abriu). */
      sourceLabel: string | null;
    }
  | { ok: false; code: 'invalid_url' | 'unidentified'; message: string; guess: Partial<Identity> | null };

export function accentHexes(dominant: string | null) {
  if (!dominant) return { accentColor: null, accentGlow: null };
  const hex = rgbToHex(oklabToRgb(accentFor(dominant)));
  return { accentColor: hex, accentGlow: `${hex}52` };
}

export async function importFromUrl(rawUrl: string, identity: Partial<Identity> | null, onStage: (stage: ImportStage) => void = () => {}, variantId: string | null = null): Promise<ImportOutcome> {
  const outcome = await resolveProduct({ url: rawUrl, identity, variantId }, onStage);
  if (outcome.ok === 'choose') {
    console.log(`[importar] ${outcome.identity.brand} · ${outcome.identity.name} — escolher: ${outcome.variants.map((v) => v.volume ?? v.label).join(' / ')}`);
    return {
      ok: 'choose',
      brand: outcome.identity.brand,
      name: outcome.identity.name,
      concentration: outcome.identity.concentration ?? null,
      variants: outcome.variants,
      preselectedId: outcome.preselectedId,
      sourceLabel: outcome.source?.label ?? null,
    };
  }
  if (!outcome.ok) {
    console.warn(`[importar] ${outcome.reason}: ${outcome.evidence.join(' | ')}`);
    return { ok: false, code: outcome.reason, message: outcome.message, guess: outcome.guess };
  }
  const p = outcome.product;
  console.log(`[importar] ${p.identity.brand} · ${p.identity.name} — ${p.evidence.join(' | ')}`);
  const notes: string[] = [];
  let media: SavedMedia | null = null;
  let imageSource: ImageSource | null = null;
  if (p.image) {
    media = await saveBottleMedia(p.image.bottle);
    const c = p.image.candidate;
    imageSource = { origin: c.origin, url: c.url, pageUrl: c.pageUrl, label: c.label, score: Math.round(p.image.score) };
  } else {
    notes.push('Nenhuma foto encontrada passou no controle de qualidade — o frasco aparece como silhueta até achar uma boa.');
  }
  if (!p.olfactoryProfile) notes.push('O perfil olfativo ainda não foi encontrado em fontes confiáveis.');
  onStage('done');
  return {
    ok: true,
    notes,
    perfume: {
      name: p.identity.name,
      brand: p.identity.brand,
      description: p.description,
      concentration: p.identity.concentration ?? null,
      volume: p.identity.volume ?? null,
      gender: p.gender,
      price: p.price?.value ?? null,
      currency: p.price?.currency ?? null,
      sourceUrl: p.sourceUrl,
      media,
      imageCredit: imageSource?.label ?? null,
      imageSource,
      ...accentHexes(media?.dominantColor ?? null),
      olfactoryProfile: p.olfactoryProfile,
      fieldSources: p.fieldSources,
      variant: p.variant,
      variants: p.variants,
      variantUrl: p.variant?.url ?? null,
      // Com mais de uma variante, a pessoa já confirmou a escolha: a identidade vale como confirmada.
      confidence: p.variants.length > 1 && variantId ? 'high' : p.level,
    },
  };
}
