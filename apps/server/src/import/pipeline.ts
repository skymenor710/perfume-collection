import { oklabToRgb, rgbToHex } from '@perfumes/core/color';
import type { OlfactoryProfile } from '@perfumes/core/olfactory';
import type { Gender, ImageSource } from '@perfumes/core/perfume';
import { accentFor } from '@perfumes/core/accent';
import { event, hostOf, log, safeUrl } from '../log';
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

/** A importação foi cancelada (job cancelado ou conexão fechada). */
export class ImportCancelledError extends Error {
  readonly code = 'cancelled';
  constructor() {
    super('Importação cancelada');
  }
}

export interface ImportContext {
  /** Correlação nos logs (job da API v1). */
  jobId?: string;
  /** Cancelamento cooperativo: conferido a cada etapa. */
  signal?: AbortSignal;
  via?: 'job' | 'legacy';
}

/**
 * Link → perfume, com os eventos estruturados de importação (início, fim, falha, cancelamento).
 * O link aparece nos logs só como origem + caminho (sem query string).
 */
export async function importFromUrl(
  rawUrl: string,
  identity: Partial<Identity> | null,
  onStage: (stage: ImportStage) => void = () => {},
  variantId: string | null = null,
  context: ImportContext = {},
): Promise<ImportOutcome> {
  const started = Date.now();
  const base = { jobId: context.jobId, via: context.via ?? 'legacy', url: safeUrl(rawUrl), withIdentity: Boolean(identity?.name), withVariant: Boolean(variantId) };
  const cancelled = () => context.signal?.aborted === true;
  event('import.started', base);
  try {
    const outcome = await runImport(
      rawUrl,
      identity,
      (stage) => {
        if (cancelled()) throw new ImportCancelledError();
        onStage(stage);
      },
      variantId,
    );
    if (cancelled()) throw new ImportCancelledError();
    const durationMs = Date.now() - started;
    if (outcome.ok === true) {
      const p = outcome.perfume;
      event('import.completed', {
        ...base,
        durationMs,
        brand: p.brand,
        name: p.name,
        confidence: p.confidence,
        image: p.imageSource ? { origin: p.imageSource.origin, host: hostOf(p.imageSource.url), score: p.imageSource.score } : null,
        sources: [...new Set(Object.values(p.fieldSources).map((f) => f.label))],
      });
    } else if (outcome.ok === 'choose') {
      event('import.choose_variant', { ...base, durationMs, brand: outcome.brand, name: outcome.name, variants: outcome.variants.length });
    } else {
      event('import.failed', { ...base, durationMs, code: outcome.code }, 'warn');
    }
    return outcome;
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof ImportCancelledError) event('import.cancelled', { ...base, durationMs });
    else log.error({ event: 'import.failed', ...base, durationMs, code: 'internal', err: error });
    throw error;
  }
}

async function runImport(rawUrl: string, identity: Partial<Identity> | null, onStage: (stage: ImportStage) => void, variantId: string | null): Promise<ImportOutcome> {
  const outcome = await resolveProduct({ url: rawUrl, identity, variantId }, onStage);
  if (outcome.ok === 'choose') {
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
    log.debug({ event: 'import.evidence', reason: outcome.reason, evidence: outcome.evidence });
    return { ok: false, code: outcome.reason, message: outcome.message, guess: outcome.guess };
  }
  const p = outcome.product;
  log.debug({ event: 'import.evidence', brand: p.identity.brand, name: p.identity.name, evidence: p.evidence });
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
