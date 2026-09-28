import { LIBRARY_SCHEMA, type Entry, type Library, type Product, type ProductImage, type User } from '@perfumes/core/library';
import type { PerfumeVariant } from '@perfumes/core/perfume';
import { volumeMl } from '@perfumes/core/volume';
import type { entries, productImages, products, productVariants, users } from './schema';

/**
 * Domínio (Library: users · products · entries) ⇄ linhas do Postgres. É o ÚNICO lugar que conhece as duas formas:
 * o repositório, a importação e a verificação passam por aqui, então ida e volta são a mesma regra.
 */

export type UserRow = typeof users.$inferInsert;
export type ProductRow = typeof products.$inferInsert;
export type VariantRow = typeof productVariants.$inferInsert;
export type ImageRow = Omit<typeof productImages.$inferInsert, 'id' | 'createdAt'>;
export type EntryRow = typeof entries.$inferInsert;

export interface LibraryRows {
  users: UserRow[];
  products: ProductRow[];
  variants: VariantRow[];
  images: ImageRow[];
  entries: EntryRow[];
}

const date = (iso: string) => new Date(iso);
const optDate = (iso: string | null) => (iso ? new Date(iso) : null);
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const optIso = (d: Date | string | null | undefined) => (d ? iso(d) : null);
/** numeric chega como texto ("35.95"); dinheiro nunca passa por conta em ponto flutuante — só a conversão final. */
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const money = (v: number | null) => (v === null ? null : v.toFixed(2));
const mlText = (v: number | null) => (v === null ? null : String(v));

/* ------------------------------------------------------------------ domínio → linhas */

export function userToRow(u: User): UserRow {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarRef: u.avatarUrl,
    bio: u.bio,
    privacyProfile: u.privacy.profile,
    privacyWishlist: u.privacy.wishlist,
    privacyCollection: u.privacy.collection,
    createdAt: date(u.createdAt),
    updatedAt: date(u.updatedAt),
  };
}

export function productToRows(p: Product): { product: ProductRow; variants: VariantRow[]; images: ImageRow[] } {
  return {
    product: {
      id: p.id,
      brand: p.brand,
      name: p.name,
      concentration: p.concentration,
      gender: p.gender,
      description: p.description,
      olfactoryProfile: p.olfactoryProfile,
      dominantColor: p.appearance.dominantColor,
      dominantColorOverride: p.appearance.dominantColorOverride,
      accentColor: p.appearance.accentColor,
      accentGlow: p.appearance.accentGlow,
      model3dRef: p.model3DUrl,
      fieldSources: p.fieldSources,
      origin: p.origin,
      assetVersion: p.assetVersion,
      createdAt: date(p.createdAt),
      updatedAt: date(p.updatedAt),
    },
    variants: p.variants.map((v, position) => ({
      productId: p.id,
      id: v.id,
      position,
      label: v.label,
      volumeText: v.volume,
      volumeMl: mlText(volumeMl(v.volume)),
      price: money(v.price),
      currency: v.currency,
      sku: v.sku,
      available: v.available,
      url: v.url,
    })),
    images: p.images.map((i, position) => ({
      productId: p.id,
      position,
      role: i.role,
      ref: i.url,
      thumbRef: i.thumbUrl,
      masterRef: i.masterUrl,
      variantId: i.variantId,
      transparent: i.transparent,
      source: i.source,
      credit: i.credit,
    })),
  };
}

export function entryToRow(e: Entry): EntryRow {
  return {
    id: e.id,
    userId: e.userId,
    productId: e.productId,
    list: e.list,
    variantId: e.variantId,
    position: e.position,
    rating: e.rating,
    notes: e.notes,
    sourceUrl: e.sourceUrl,
    variantUrl: e.variantUrl,
    volumeText: e.volume,
    volumeMl: mlText(volumeMl(e.volume)),
    price: money(e.price),
    currency: e.currency,
    priceNote: e.priceNote,
    addedAt: date(e.addedAt),
    acquiredAt: optDate(e.acquiredAt),
    updatedAt: date(e.updatedAt),
  };
}

export function libraryToRows(lib: Library): LibraryRows {
  const split = lib.products.map(productToRows);
  return {
    users: lib.users.map(userToRow),
    products: split.map((s) => s.product),
    variants: split.flatMap((s) => s.variants),
    images: split.flatMap((s) => s.images),
    entries: lib.entries.map(entryToRow),
  };
}

/* ------------------------------------------------------------------ linhas → domínio */

export type UserRecord = typeof users.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
export type VariantRecord = typeof productVariants.$inferSelect;
export type ImageRecord = typeof productImages.$inferSelect;
export type EntryRecord = typeof entries.$inferSelect;

export function rowToUser(r: UserRecord): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarRef,
    bio: r.bio,
    privacy: { profile: r.privacyProfile, wishlist: r.privacyWishlist, collection: r.privacyCollection },
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function rowsToProduct(r: ProductRecord, variants: VariantRecord[], images: ImageRecord[]): Product {
  return {
    id: r.id,
    brand: r.brand,
    name: r.name,
    concentration: r.concentration,
    gender: r.gender,
    description: r.description,
    olfactoryProfile: r.olfactoryProfile ?? null,
    variants: [...variants]
      .sort((a, b) => a.position - b.position)
      .map(
        (v): PerfumeVariant => ({
          id: v.id,
          label: v.label,
          volume: v.volumeText,
          price: num(v.price),
          currency: v.currency,
          sku: v.sku,
          available: v.available,
          url: v.url,
        }),
      ),
    images: [...images]
      .sort((a, b) => a.position - b.position)
      .map(
        (i): ProductImage => ({
          role: i.role,
          url: i.ref,
          thumbUrl: i.thumbRef,
          masterUrl: i.masterRef,
          variantId: i.variantId,
          transparent: i.transparent,
          source: i.source ?? null,
          credit: i.credit,
        }),
      ),
    appearance: { dominantColor: r.dominantColor, dominantColorOverride: r.dominantColorOverride, accentColor: r.accentColor, accentGlow: r.accentGlow },
    model3DUrl: r.model3dRef,
    fieldSources: r.fieldSources,
    origin: r.origin,
    assetVersion: r.assetVersion,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function rowToEntry(r: EntryRecord): Entry {
  return {
    id: r.id,
    userId: r.userId,
    productId: r.productId,
    list: r.list,
    variantId: r.variantId,
    position: r.position,
    rating: r.rating,
    notes: r.notes,
    sourceUrl: r.sourceUrl,
    variantUrl: r.variantUrl,
    volume: r.volumeText,
    price: num(r.price),
    currency: r.currency,
    priceNote: r.priceNote,
    addedAt: iso(r.addedAt),
    acquiredAt: optIso(r.acquiredAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function rowsToLibrary(rows: { users: UserRecord[]; products: ProductRecord[]; variants: VariantRecord[]; images: ImageRecord[]; entries: EntryRecord[] }): Library {
  const byProduct = <T extends { productId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) map.set(item.productId, [...(map.get(item.productId) ?? []), item]);
    return map;
  };
  const variants = byProduct(rows.variants);
  const images = byProduct(rows.images);
  return {
    schemaVersion: LIBRARY_SCHEMA,
    users: rows.users.map(rowToUser),
    products: rows.products.map((p) => rowsToProduct(p, variants.get(p.id) ?? [], images.get(p.id) ?? [])),
    entries: rows.entries.map(rowToEntry),
  };
}
