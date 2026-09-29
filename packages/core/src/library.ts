/**
 * Modelo de dados em três entidades (contextos: Identidade · Catálogo · Biblioteca):
 *
 *   USER     quem é a pessoa (username único, nome, avatar, bio) e o que ela torna público
 *   PRODUCT  o perfume em si — compartilhável entre usuários: marca, nome, concentração, notas, VERSÕES e IMAGENS
 *   ENTRY    a relação da pessoa com um produto: em qual lista (wishlist/coleção), qual versão, posição,
 *            veredito, observação, o link que ela colou e o preço que ela viu
 *
 * A interface continua trabalhando com a "visão" `Perfume` (entrada + produto + imagem principal), montada aqui.
 * `toPerfumeView(fromPerfume(p))` devolve exatamente `p`: a troca de armazenamento não perde nada (há teste).
 * TS puro, sem DOM: serve ao servidor, ao navegador e a um futuro app nativo.
 */

import { sanitizePerfume, safeImageRef, type FieldSource, type Gender, type ImageSource, type OlfactoryProfile, type Perfume, type PerfumeOrigin, type PerfumeVariant, type PersonalRating } from './perfume';

export const LIBRARY_SCHEMA = 2;

export type Visibility = 'private' | 'public';
export type ListKind = 'wishlist' | 'collection';

export interface Privacy {
  profile: Visibility;
  wishlist: Visibility;
  collection: Visibility;
}

export interface User {
  id: string;
  /** Único, minúsculo: vira o endereço público (/username, /username/wishlist). */
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  /** Padrão: tudo privado. Só o que a pessoa abrir aparece em URL pública. */
  privacy: Privacy;
  createdAt: string;
  updatedAt: string;
}

/** Uma imagem do produto. A principal é a do palco; alternativas ficam para trocar sem nova pesquisa. */
export interface ProductImage {
  role: 'main' | 'alternate';
  /** WebP grande (palco) e pequeno (vizinhos), e o PNG mestre 2048² transparente. */
  url: string;
  thumbUrl: string | null;
  masterUrl: string | null;
  /** Versão do produto que a foto mostra (50 ml ≠ 100 ml). Nulo = a foto vale para o produto. */
  variantId: string | null;
  /** Fundo transparente de verdade (recorte do app). Nulo = não se sabe (foto antiga enviada). */
  transparent: boolean | null;
  source: ImageSource | null;
  credit: string | null;
}

/** Cor do frasco (vem da imagem principal) e o sotaque que ela dá à galáxia. */
export interface Appearance {
  dominantColor: string | null;
  /** Correção manual; vence a extraída. */
  dominantColorOverride: string | null;
  accentColor: string | null;
  accentGlow: string | null;
}

export interface Product {
  id: string;
  brand: string | null;
  name: string;
  concentration: string | null;
  gender: Gender | null;
  description: string | null;
  olfactoryProfile: OlfactoryProfile | null;
  /** Versões reais (50 ml, 100 ml…): cada uma com preço, SKU, disponibilidade e link. */
  variants: PerfumeVariant[];
  images: ProductImage[];
  appearance: Appearance;
  model3DUrl: string | null;
  fieldSources: Record<string, FieldSource>;
  /** Como o produto entrou no catálogo. */
  origin: PerfumeOrigin;
  assetVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  userId: string;
  productId: string;
  list: ListKind;
  /** A versão que a pessoa quer/tem. */
  variantId: string | null;
  position: number;
  rating: PersonalRating | null;
  notes: string | null;
  /** O link que a pessoa colou (o ↗ abre ele, ou a variante na mesma loja). */
  sourceUrl: string | null;
  variantUrl: string | null;
  /** O que a pessoa viu ao adicionar (ou corrigiu à mão): tamanho e preço. */
  volume: string | null;
  price: number | null;
  currency: string | null;
  priceNote: string | null;
  addedAt: string;
  acquiredAt: string | null;
  updatedAt: string;
}

export interface Library {
  schemaVersion: typeof LIBRARY_SCHEMA;
  users: User[];
  products: Product[];
  entries: Entry[];
}

/* ------------------------------------------------------------------ usuário */

/** Endereços que já são do app: ninguém pode se chamar assim. */
export const RESERVED_USERNAMES = new Set([
  'api', 'media', 'bottles', 'assets', 'icons', 'models', 'sw.js', 'manifest.webmanifest', 'index.html', 'favicon.ico',
  'app', 'admin', 'login', 'logout', 'signup', 'settings', 'config', 'help', 'about', 'wishlist', 'collection', 'colecao',
  'share', 'public', 'static', 'u', 'user', 'users', 'me', 'perfumes', 'www', 'root', 'null', 'undefined',
]);

/** 3–30 caracteres: letras minúsculas, números, ponto e sublinhado; sem começar/terminar com ponto. */
export function validateUsername(raw: string): { ok: true; username: string } | { ok: false; message: string } {
  const username = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._]{1,28})[a-z0-9]$/.test(username) || /\.\./.test(username)) {
    return { ok: false, message: 'Use de 3 a 30 letras minúsculas, números, ponto ou sublinhado.' };
  }
  if (RESERVED_USERNAMES.has(username)) return { ok: false, message: 'Esse nome é reservado pelo app. Escolha outro.' };
  return { ok: true, username };
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/<[^>]*>/g, ' ').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};
const vis = (v: unknown): Visibility => (v === 'public' ? 'public' : 'private');
const iso = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

export function sanitizeUser(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[\w-]{1,80}$/.test(r.id) ? r.id : null;
  const username = typeof r.username === 'string' ? validateUsername(r.username) : null;
  if (!id || !username?.ok) return null;
  const now = new Date().toISOString();
  const privacy = (r.privacy ?? {}) as Record<string, unknown>;
  return {
    id,
    username: username.username,
    displayName: text(r.displayName, 60) ?? username.username,
    avatarUrl: safeImageRef(r.avatarUrl),
    bio: text(r.bio, 280),
    privacy: { profile: vis(privacy.profile), wishlist: vis(privacy.wishlist), collection: vis(privacy.collection) },
    createdAt: iso(r.createdAt, now),
    updatedAt: iso(r.updatedAt, now),
  };
}

/* ------------------------------------------------------------------ visão Perfume ⇄ produto + entrada */

const PERSON_FIELDS = new Set(['status', 'personalRating', 'acquiredAt', 'order', 'createdAt', 'updatedAt', 'sourceUrl', 'variantUrl', 'volume', 'price', 'currency', 'priceNote', 'selectedVariantId']);

/** Separa um registro antigo (tudo junto) em produto + entrada. IDs preservados: produto e entrada herdam o do perfume. */
export function fromPerfume(p: Perfume, userId: string): { product: Product; entry: Entry } {
  const variantImage = p.variants.length > 1 ? p.selectedVariantId : null;
  const product: Product = {
    id: p.id,
    brand: p.brand,
    name: p.name,
    concentration: p.concentration,
    gender: p.gender,
    description: p.description,
    olfactoryProfile: p.olfactoryProfile,
    variants: p.variants,
    images: p.imageUrl
      ? [
          {
            role: 'main',
            url: p.imageUrl,
            thumbUrl: p.thumbUrl,
            masterUrl: p.masterUrl,
            variantId: variantImage,
            // Fotos processadas pelo app (planilha e importadas) são recortes transparentes; fotos antigas enviadas pelo
            // navegador podem não ter sido recortadas.
            // "p/…" (R2, por conteúdo) é a mesma foto processada, só guardada em outro lugar.
            transparent: /^(bottles|media|p)\//.test(p.imageUrl) ? true : null,
            source: p.imageSource,
            credit: p.imageCredit,
          },
        ]
      : [],
    appearance: { dominantColor: p.dominantColor, dominantColorOverride: p.dominantColorOverride, accentColor: p.accentColor, accentGlow: p.accentGlow },
    model3DUrl: p.model3DUrl,
    fieldSources: p.fieldSources,
    origin: p.origin,
    assetVersion: p.assetVersion,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  const entry: Entry = {
    id: p.id,
    userId,
    productId: p.id,
    list: p.status === 'owned' ? 'collection' : 'wishlist',
    variantId: p.selectedVariantId,
    position: p.order,
    rating: p.personalRating,
    notes: null,
    sourceUrl: p.sourceUrl,
    variantUrl: p.variantUrl,
    volume: p.volume,
    price: p.price,
    currency: p.currency,
    priceNote: p.priceNote,
    addedAt: p.createdAt,
    acquiredAt: p.acquiredAt,
    updatedAt: p.updatedAt,
  };
  return { product, entry };
}

/** A visão que a interface usa: a entrada da pessoa + o produto + a imagem principal. */
export function toPerfumeView(entry: Entry, product: Product): Perfume {
  const main = product.images.find((i) => i.role === 'main') ?? null;
  const view = sanitizePerfume({
    id: entry.id,
    name: product.name,
    brand: product.brand,
    sourceUrl: entry.sourceUrl,
    imageUrl: main?.url ?? null,
    thumbUrl: main?.thumbUrl ?? null,
    masterUrl: main?.masterUrl ?? null,
    model3DUrl: product.model3DUrl,
    dominantColor: product.appearance.dominantColor,
    dominantColorOverride: product.appearance.dominantColorOverride,
    description: product.description,
    concentration: product.concentration,
    gender: product.gender,
    volume: entry.volume,
    price: entry.price,
    currency: entry.currency,
    priceNote: entry.priceNote,
    status: entry.list === 'collection' ? 'owned' : 'wishlist',
    personalRating: entry.rating,
    acquiredAt: entry.acquiredAt,
    origin: product.origin,
    imageCredit: main?.credit ?? null,
    imageSource: main?.source ?? null,
    accentColor: product.appearance.accentColor,
    accentGlow: product.appearance.accentGlow,
    olfactoryProfile: product.olfactoryProfile,
    fieldSources: product.fieldSources,
    variants: product.variants,
    selectedVariantId: entry.variantId,
    variantUrl: entry.variantUrl,
    assetVersion: product.assetVersion,
    order: entry.position,
    createdAt: entry.addedAt,
    updatedAt: entry.updatedAt > product.updatedAt ? entry.updatedAt : product.updatedAt,
  });
  if (!view) throw new Error(`visão inválida para a entrada ${entry.id}`);
  return view;
}

/**
 * Uma visão alterada pela interface (PUT) volta para produto + entrada. A imagem principal é substituída quando a
 * visão traz outra; as alternativas ficam. Com um usuário só, editar o nome altera o produto; com vários, isso vira
 * sobrescrita por entrada (fase 4 do plano).
 */
export function applyPerfumeView(existing: { product: Product; entry: Entry } | null, view: Perfume, userId: string): { product: Product; entry: Entry } {
  const next = fromPerfume(view, userId);
  if (!existing) return next;
  const keptAlternates = existing.product.images.filter((i) => i.role === 'alternate' && i.url !== view.imageUrl);
  return {
    product: { ...next.product, id: existing.product.id, images: [...next.product.images, ...keptAlternates], createdAt: existing.product.createdAt },
    entry: { ...next.entry, productId: existing.product.id, notes: existing.entry.notes, userId: existing.entry.userId },
  };
}

/** Campos que são da pessoa (não do perfume) — úteis para montar visões públicas e sobrescritas futuras. */
export const isPersonField = (key: string) => PERSON_FIELDS.has(key);

/* ------------------------------------------------------------------ privacidade e visão pública */

/** O que uma visita sem conta pode ver de uma lista pública: o perfume e a versão — nunca observações privadas. */
export function toPublicView(view: Perfume): Perfume {
  return { ...view, fieldSources: {}, priceNote: null };
}

export function publicLists(user: User): ListKind[] {
  return (['wishlist', 'collection'] as const).filter((l) => user.privacy[l] === 'public');
}

/* ------------------------------------------------------------------ biblioteca inteira */

function sanitizeImage(raw: unknown): ProductImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = safeImageRef(r.url);
  if (!url) return null;
  const probe = sanitizePerfume({ id: 'x', name: 'x', imageSource: r.source });
  return {
    role: r.role === 'alternate' ? 'alternate' : 'main',
    url,
    thumbUrl: safeImageRef(r.thumbUrl),
    masterUrl: safeImageRef(r.masterUrl),
    variantId: typeof r.variantId === 'string' ? r.variantId.slice(0, 80) : null,
    transparent: typeof r.transparent === 'boolean' ? r.transparent : null,
    source: probe?.imageSource ?? null,
    credit: text(r.credit, 120),
  };
}

/**
 * Lê a biblioteca guardada sem confiar nela: cada produto e entrada passam pela mesma sanitização da visão
 * (uma entrada que não vira visão válida é descartada com aviso, em vez de derrubar o app).
 */
export function sanitizeLibrary(raw: unknown): { library: Library; dropped: number } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const users = (Array.isArray(r.users) ? r.users : []).map(sanitizeUser).filter((u): u is User => u !== null);
  const products = new Map<string, Product>();
  for (const p of Array.isArray(r.products) ? (r.products as Record<string, unknown>[]) : []) {
    const images = (Array.isArray(p.images) ? p.images : []).map(sanitizeImage).filter((i): i is ProductImage => i !== null);
    const appearance = (p.appearance ?? {}) as Record<string, unknown>;
    // A visão faz a validação de todos os campos do produto; daqui só se aproveita o resultado.
    const probe = sanitizePerfume({ ...p, dominantColor: appearance.dominantColor, dominantColorOverride: appearance.dominantColorOverride, accentColor: appearance.accentColor, accentGlow: appearance.accentGlow });
    if (!probe) continue;
    products.set(probe.id, {
      id: probe.id,
      brand: probe.brand,
      name: probe.name,
      concentration: probe.concentration,
      gender: probe.gender,
      description: probe.description,
      olfactoryProfile: probe.olfactoryProfile,
      variants: probe.variants,
      images,
      appearance: { dominantColor: probe.dominantColor, dominantColorOverride: probe.dominantColorOverride, accentColor: probe.accentColor, accentGlow: probe.accentGlow },
      model3DUrl: probe.model3DUrl,
      fieldSources: probe.fieldSources,
      origin: probe.origin,
      assetVersion: probe.assetVersion,
      createdAt: probe.createdAt,
      updatedAt: probe.updatedAt,
    });
  }
  const userIds = new Set(users.map((u) => u.id));
  const entries: Entry[] = [];
  let dropped = 0;
  for (const e of Array.isArray(r.entries) ? (r.entries as Record<string, unknown>[]) : []) {
    const product = typeof e.productId === 'string' ? products.get(e.productId) : undefined;
    const userId = typeof e.userId === 'string' && userIds.has(e.userId) ? e.userId : null;
    if (!product || !userId || typeof e.id !== 'string') {
      dropped++;
      continue;
    }
    const view = sanitizePerfume({
      id: e.id,
      name: product.name,
      status: e.list === 'collection' ? 'owned' : 'wishlist',
      personalRating: e.rating,
      acquiredAt: e.acquiredAt,
      order: e.position,
      createdAt: e.addedAt,
      updatedAt: e.updatedAt,
      sourceUrl: e.sourceUrl,
      variantUrl: e.variantUrl,
      volume: e.volume,
      price: e.price,
      currency: e.currency,
      priceNote: e.priceNote,
      selectedVariantId: e.variantId,
    });
    if (!view) {
      dropped++;
      continue;
    }
    entries.push({
      id: view.id,
      userId,
      productId: product.id,
      list: view.status === 'owned' ? 'collection' : 'wishlist',
      variantId: view.selectedVariantId,
      position: view.order,
      rating: view.personalRating,
      notes: text(e.notes, 1000),
      sourceUrl: view.sourceUrl,
      variantUrl: view.variantUrl,
      volume: view.volume,
      price: view.price,
      currency: view.currency,
      priceNote: view.priceNote,
      addedAt: view.createdAt,
      acquiredAt: view.acquiredAt,
      updatedAt: view.updatedAt,
    });
  }
  return { library: { schemaVersion: LIBRARY_SCHEMA, users, products: [...products.values()], entries }, dropped };
}

/** Todas as imagens que a biblioteca usa (para não apagar arquivo em uso). */
export function referencedImages(library: Library): Set<string> {
  const out = new Set<string>();
  for (const p of library.products) for (const i of p.images) for (const ref of [i.url, i.thumbUrl, i.masterUrl]) if (ref) out.add(ref);
  for (const u of library.users) if (u.avatarUrl) out.add(u.avatarUrl);
  return out;
}


/* ------------------------------------------------------------------ endereços públicos */

export interface PublicPath {
  username: string;
  list: ListKind | null;
}

/** "/guilherme", "/guilherme/wishlist", "/guilherme/collection" (e "colecao" como apelido). O resto não é página pública. */
export function parsePublicPath(pathname: string): PublicPath | null {
  const m = /^\/([a-z0-9][a-z0-9._]{1,28}[a-z0-9])(?:\/(wishlist|collection|colecao))?\/?$/i.exec(pathname);
  if (!m || RESERVED_USERNAMES.has(m[1].toLowerCase()) || /\.\./.test(m[1])) return null;
  return { username: m[1].toLowerCase(), list: m[2] ? (m[2].toLowerCase() === 'wishlist' ? 'wishlist' : 'collection') : null };
}
