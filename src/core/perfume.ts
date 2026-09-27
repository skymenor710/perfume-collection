/**
 * O modelo de um perfume. Um só formato para os três lugares onde a coleção pode morar
 * (servidor no computador, conta do claude.ai, navegador) — e para o que vier depois
 * (notas olfativas, histórico de preço, comparações): campos novos entram como opcionais.
 */

import { isHex } from './color';
import { sanitizeProfile, type OlfactoryProfile } from './olfactory';

export type { OlfactoryProfile } from './olfactory';

export interface ImageSource {
  origin: 'brand' | 'fragrantica' | 'retailer' | 'source' | 'search' | 'upload';
  /** A imagem original. */
  url: string | null;
  /** A página onde ela estava. */
  pageUrl: string | null;
  /** Nome legível da fonte ("afnan.com", "Parfumo"). */
  label: string | null;
  score: number | null;
}

/** Geração atual do pipeline de imagem + pesquisa olfativa. Subir quando o pipeline mudar de forma relevante. */
export const ASSET_VERSION = 3;

/** De onde veio cada campo (nome, marca, preço, foto, notas): identidade do produto separada do link colado. */
export type FieldSourceKind = 'page' | 'url' | 'official' | 'retailer' | 'database' | 'search' | 'user';
export interface FieldSource {
  kind: FieldSourceKind;
  /** Nome legível da fonte ("afnan.com", "Parfumo", "você"). */
  label: string;
  url: string | null;
}
const FIELD_KINDS: FieldSourceKind[] = ['page', 'url', 'official', 'retailer', 'database', 'search', 'user'];
const FIELD_NAMES = ['name', 'brand', 'concentration', 'volume', 'price', 'image', 'olfactoryProfile'];

function sanitizeFieldSources(raw: unknown): Record<string, FieldSource> {
  const out: Record<string, FieldSource> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_NAMES.includes(key) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (!FIELD_KINDS.includes(v.kind as FieldSourceKind)) continue;
    out[key] = {
      kind: v.kind as FieldSourceKind,
      label: typeof v.label === 'string' ? v.label.replace(/<[^>]*>/g, '').slice(0, 120) : '',
      url: safeHttpUrl(v.url),
    };
  }
  return out;
}

function sanitizeImageSource(raw: unknown): ImageSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const origins = ['brand', 'fragrantica', 'retailer', 'source', 'search', 'upload'];
  const url = (v: unknown) => (typeof v === 'string' ? safeHttpUrl(v) : null);
  return {
    origin: origins.includes(r.origin as string) ? (r.origin as ImageSource['origin']) : 'source',
    url: url(r.url),
    pageUrl: url(r.pageUrl),
    label: typeof r.label === 'string' ? r.label.replace(/<[^>]*>/g, '').slice(0, 120) : null,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? Math.round(r.score) : null,
  };
}

/**
 * Uma variante real do produto (50 ml, 100 ml, tester…). PRODUTO ≠ VARIANTE: o perfume guardado é UMA variante,
 * e tamanho, preço, moeda, SKU e link andam juntos aqui — nunca se misturam com os de outra.
 */
export interface PerfumeVariant {
  id: string;
  label: string;
  volume: string | null;
  price: number | null;
  currency: string | null;
  sku: string | null;
  available: boolean | null;
  /** Link da loja com esta variante escolhida (null quando a variante veio de outra loja). */
  url: string | null;
}

function sanitizeVariants(raw: unknown): PerfumeVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((v): PerfumeVariant | null => {
      if (!v || typeof v !== 'object') return null;
      const r = v as Record<string, unknown>;
      const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id).slice(0, 80) : null;
      if (!id) return null;
      const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0 && r.price < 1e6 ? Math.round(r.price * 100) / 100 : null;
      return {
        id,
        label: typeof r.label === 'string' ? r.label.replace(/<[^>]*>/g, '').slice(0, 60) : id,
        volume: typeof r.volume === 'string' ? r.volume.slice(0, 30) : null,
        price,
        currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
        sku: typeof r.sku === 'string' ? r.sku.slice(0, 60) : null,
        available: typeof r.available === 'boolean' ? r.available : null,
        url: safeHttpUrl(r.url),
      };
    })
    .filter((v): v is PerfumeVariant => v !== null);
}

export type PerfumeStatus = 'wishlist' | 'owned';
export type PersonalRating = 'rebuy' | 'very_good' | 'good' | 'do_not_rebuy';
export type Gender = 'masculine' | 'feminine' | 'unisex';
export type PerfumeOrigin = 'google-sheet' | 'url-import' | 'manual';

export interface Perfume {
  id: string;
  name: string;
  brand: string | null;
  /** Página original do produto. Nunca exibida como texto — só pelo ícone ↗. */
  sourceUrl: string | null;
  /** Frasco recortado em alta (palco). */
  imageUrl: string | null;
  /** O mesmo frasco, leve, para quem está ao fundo do carrossel. */
  thumbUrl: string | null;
  /** Arquivo mestre: PNG 2048×2048, fundo transparente, frasco centrado com a base na mesma altura. */
  masterUrl: string | null;
  /** Modelo 3D real (GLB/GLTF). Nulo até existir um de verdade — nada de reconstrução inventada. */
  model3DUrl: string | null;
  /** Cor extraída do frasco (#rrggbb). */
  dominantColor: string | null;
  /** Correção manual da cor; vence a extraída. */
  dominantColorOverride: string | null;
  description: string | null;
  concentration: string | null;
  gender: Gender | null;
  volume: string | null;
  price: number | null;
  currency: string | null;
  /** "aprox.", "esgotado no site oficial"… o que vinha junto do preço. */
  priceNote: string | null;
  status: PerfumeStatus;
  personalRating: PersonalRating | null;
  /** Quando saiu da wishlist para a coleção. */
  acquiredAt: string | null;
  origin: PerfumeOrigin;
  /** De onde veio a foto (a loja do link, o site da marca, uma foto enviada). */
  imageCredit: string | null;
  /** De onde veio a foto escolhida pela pesquisa automática, e a nota que ela tirou (0–100+). */
  imageSource: ImageSource | null;
  /** Sotaque derivado da cor do frasco, já domesticado para a interface (#rrggbb). */
  accentColor: string | null;
  /** Versão translúcida do sotaque para brilhos (#rrggbbaa). */
  accentGlow: string | null;
  olfactoryProfile: OlfactoryProfile | null;
  /** Origem de cada campo pesquisado. */
  fieldSources: Record<string, FieldSource>;
  /** Variantes que a loja oferece e a escolhida (a que este perfume É). Vazio quando a loja só tem uma. */
  variants: PerfumeVariant[];
  selectedVariantId: string | null;
  /** Link da loja já na variante escolhida; o ↗ abre ele quando existe (senão, o link original). */
  variantUrl: string | null;
  /** Geração do pipeline de pesquisa que produziu foto e perfil (para reprocessar coleções antigas). */
  assetVersion: number;
  /** Posição manual na lista (menor primeiro); empate cai na data de criação. */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export const RATINGS: { id: PersonalRating; label: string }[] = [
  { id: 'rebuy', label: 'Comprar novamente' },
  { id: 'very_good', label: 'Muito bom' },
  { id: 'good', label: 'Bom' },
  { id: 'do_not_rebuy', label: 'Não comprar novamente' },
];

export const ratingLabel = (rating: PersonalRating | null) => RATINGS.find((r) => r.id === rating)?.label ?? null;

const STATUSES: PerfumeStatus[] = ['wishlist', 'owned'];
const RATING_IDS = RATINGS.map((r) => r.id);
const GENDERS: Gender[] = ['masculine', 'feminine', 'unisex'];
const ORIGINS: PerfumeOrigin[] = ['google-sheet', 'url-import', 'manual'];

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // Texto vindo de loja: sem tags, sem caracteres de controle, espaço normalizado.
  const clean = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, max) : null;
};

/** Só http(s). Qualquer outro esquema (javascript:, data:, file:) vira nulo. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Imagem do próprio app: caminho relativo, /media, /_blob (claude.ai) ou http(s). */
export function safeImageRef(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  const v = value.trim();
  if (/^(bottles|media)\/[\w.-]+\.(webp|png|jpe?g|avif)$/i.test(v)) return v;
  if (/^\/(media|_blob)\/[\w.-]+$/i.test(v)) return v;
  if (/^data:image\/(webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(v) && v.length < 1_500_000) return v;
  return safeHttpUrl(v);
}

function modelRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^(models|media)\/[\w.-]+\.(glb|gltf)$/i.test(v)) return v;
  const url = safeHttpUrl(v);
  return url && /\.(glb|gltf)(\?|$)/i.test(url) ? url : null;
}

const iso = (value: unknown, fallback: string) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback);

/**
 * Transforma qualquer coisa (linha do banco, JSON antigo, resposta de API) num Perfume válido — ou nulo
 * quando nem nome tem. Nunca confia no que veio de fora: é assim que dado corrompido não derruba a tela.
 */
export function sanitizePerfume(raw: unknown): Perfume | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[\w-]{1,80}$/.test(r.id) ? r.id : null;
  const name = text(r.name, 140);
  if (!id || !name) return null;
  const now = new Date().toISOString();
  const status = STATUSES.includes(r.status as PerfumeStatus) ? (r.status as PerfumeStatus) : 'wishlist';
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0 && r.price < 1e6 ? Math.round(r.price * 100) / 100 : null;
  return {
    id,
    name,
    brand: text(r.brand, 80),
    sourceUrl: safeHttpUrl(r.sourceUrl),
    imageUrl: safeImageRef(r.imageUrl),
    thumbUrl: safeImageRef(r.thumbUrl),
    masterUrl: safeImageRef(r.masterUrl),
    model3DUrl: modelRef(r.model3DUrl),
    dominantColor: isHex(r.dominantColor) ? (r.dominantColor as string).toLowerCase() : null,
    dominantColorOverride: isHex(r.dominantColorOverride) ? (r.dominantColorOverride as string).toLowerCase() : null,
    description: text(r.description, 600),
    concentration: text(r.concentration, 40),
    gender: GENDERS.includes(r.gender as Gender) ? (r.gender as Gender) : null,
    volume: text(r.volume, 30),
    price,
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : price !== null ? 'EUR' : null,
    priceNote: text(r.priceNote, 80),
    status,
    personalRating: status === 'owned' && RATING_IDS.includes(r.personalRating as PersonalRating) ? (r.personalRating as PersonalRating) : null,
    acquiredAt: status === 'owned' ? iso(r.acquiredAt, now) : null,
    origin: ORIGINS.includes(r.origin as PerfumeOrigin) ? (r.origin as PerfumeOrigin) : 'manual',
    imageCredit: text(r.imageCredit, 120),
    imageSource: sanitizeImageSource(r.imageSource),
    accentColor: isHex(r.accentColor) ? (r.accentColor as string).toLowerCase() : null,
    accentGlow: typeof r.accentGlow === 'string' && /^#[0-9a-f]{8}$/i.test(r.accentGlow) ? r.accentGlow.toLowerCase() : null,
    olfactoryProfile: sanitizeProfile(r.olfactoryProfile),
    fieldSources: sanitizeFieldSources(r.fieldSources),
    variants: sanitizeVariants(r.variants),
    selectedVariantId: typeof r.selectedVariantId === 'string' || typeof r.selectedVariantId === 'number' ? String(r.selectedVariantId).slice(0, 80) : null,
    variantUrl: safeHttpUrl(r.variantUrl),
    assetVersion: typeof r.assetVersion === 'number' && Number.isFinite(r.assetVersion) ? r.assetVersion : 1,
    order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
    createdAt: iso(r.createdAt, now),
    updatedAt: iso(r.updatedAt, now),
  };
}

export function sortPerfumes(list: Perfume[]): Perfume[] {
  return [...list].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Link que o ↗ abre: a variante escolhida na loja da pessoa, senão o link que ela colou. */
export const purchaseUrl = (p: Pick<Perfume, 'variantUrl' | 'sourceUrl'>) => p.variantUrl ?? p.sourceUrl;

/** O perfume tem mais de uma versão na loja e nenhuma escolhida (itens antigos, "50/100 ml"). */
export const needsVariantChoice = (p: Pick<Perfume, 'variants' | 'selectedVariantId'>) => p.variants.length > 1 && !p.selectedVariantId;

export const effectiveColor = (p: Pick<Perfume, 'dominantColor' | 'dominantColorOverride'>) => p.dominantColorOverride ?? p.dominantColor;

/** Chave para achar duplicatas: a URL sem rastreadores, ou marca + nome sem acento e sem pontuação. */
export function urlKey(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export const nameKey = (brand: string | null, name: string) =>
  `${brand ?? ''} ${name}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function findDuplicate(list: Perfume[], candidate: { sourceUrl: string | null; brand: string | null; name: string }): Perfume | null {
  const key = urlKey(candidate.sourceUrl);
  const byName = nameKey(candidate.brand, candidate.name);
  return list.find((p) => (key && urlKey(p.sourceUrl) === key) || nameKey(p.brand, p.name) === byName) ?? null;
}

export function newId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug || 'perfume'}-${rand}`;
}

const GENDER_LABEL: Record<Gender, string> = { masculine: 'Masculino', feminine: 'Feminino', unisex: 'Unissex' };
export const genderLabel = (g: Gender | null) => (g ? GENDER_LABEL[g] : null);

export function formatPrice(p: Pick<Perfume, 'price' | 'currency'>): string | null {
  if (p.price === null) return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: p.currency ?? 'EUR' }).format(p.price);
  } catch {
    return `${p.price.toFixed(2)} ${p.currency ?? ''}`.trim();
  }
}
