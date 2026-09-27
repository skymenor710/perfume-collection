import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { OlfactoryProfile } from '@perfumes/core/olfactory';
import type { FieldSource, ImageSource } from '@perfumes/core/perfume';

/**
 * SCHEMA PRELIMINAR do Postgres (Neon) — FASE 2. Nesta etapa NÃO há conexão, NÃO há migration e NADA lê ou
 * grava aqui: `data/library.json` continua sendo a fonte de verdade. O arquivo existe para o formato ser revisado
 * antes da virada e para o tipo checar que ele cobre o domínio atual (users / products / entries, schema 2).
 *
 * Decisões (ver docs/ADR/0003):
 * - ids em texto: os ids atuais (ex.: "mykonos-reflection-r5rx34") são preservados na migração, sem tabela de-para;
 * - produto é catálogo compartilhado; entrada é a relação pessoal (lista, versão, preço pago, nota, observação);
 * - variantes em tabela própria (a escolha da pessoa aponta para uma delas);
 * - imagens guardam a CHAVE do armazenamento (R2), não URL: trocar de CDN não exige migração;
 * - jobs de importação com o mesmo formato do ImportJobStore em memória de hoje.
 */

export const visibility = pgEnum('visibility', ['private', 'public']);
export const listKind = pgEnum('list_kind', ['wishlist', 'collection']);
export const personalRating = pgEnum('personal_rating', ['rebuy', 'very_good', 'good', 'do_not_rebuy']);
export const gender = pgEnum('gender', ['masculine', 'feminine', 'unisex']);
export const perfumeOrigin = pgEnum('perfume_origin', ['google-sheet', 'url-import', 'manual']);
export const imageRole = pgEnum('image_role', ['main', 'alternate']);
export const importStatus = pgEnum('import_status', ['queued', 'running', 'waiting_choice', 'succeeded', 'failed', 'cancelled']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Pessoas. Autenticação (Better Auth, FASE 3) cria as próprias tabelas de sessão/conta ligadas a este id. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key'),
    bio: text('bio'),
    email: text('email'),
    privacyProfile: visibility('privacy_profile').notNull().default('private'),
    privacyWishlist: visibility('privacy_wishlist').notNull().default('private'),
    privacyCollection: visibility('privacy_collection').notNull().default('private'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_username_key').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    check('users_username_format', sql`${t.username} ~ '^[a-z0-9._]{3,30}$'`),
  ],
);

/** Catálogo: o perfume em si (marca, nome, pirâmide, cor), compartilhado entre pessoas. */
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    brand: text('brand'),
    name: text('name').notNull(),
    concentration: text('concentration'),
    gender: gender('gender'),
    description: text('description'),
    olfactoryProfile: jsonb('olfactory_profile').$type<OlfactoryProfile>(),
    dominantColor: text('dominant_color'),
    dominantColorOverride: text('dominant_color_override'),
    accentColor: text('accent_color'),
    accentGlow: text('accent_glow'),
    /** Modelo 3D do frasco (chave no armazenamento), quando houver. */
    model3DUrl: text('model_3d_key'),
    /** De onde veio cada campo (nome, marca, notas…), como hoje. */
    fieldSources: jsonb('field_sources').$type<Record<string, FieldSource>>().notNull().default({}),
    origin: perfumeOrigin('origin').notNull(),
    assetVersion: integer('asset_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [index('products_brand_name_idx').on(sql`lower(${t.brand})`, sql`lower(${t.name})`)],
);

/** Tamanhos/versões que a loja vende (50 ml, 100 ml…). */
export const productVariants = pgTable(
  'product_variants',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Id da loja (ex.: variante Shopify 58518844047705) — único dentro do produto. */
    id: text('id').notNull(),
    label: text('label').notNull(),
    volume: text('volume'),
    price: numeric('price', { precision: 10, scale: 2 }),
    currency: text('currency'),
    sku: text('sku'),
    available: boolean('available'),
    url: text('url'),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.id] })],
);

/** Fotos do frasco. `key` é a chave no armazenamento (R2), nunca URL absoluta. */
export const productImages = pgTable(
  'product_images',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    role: imageRole('role').notNull().default('main'),
    key: text('key').notNull(),
    thumbKey: text('thumb_key'),
    masterKey: text('master_key'),
    /** Hash do conteúdo (dedupe e chave por conteúdo no R2). */
    sha256: text('sha256'),
    variantId: text('variant_id'),
    transparent: boolean('transparent'),
    source: jsonb('source').$type<ImageSource>(),
    credit: text('credit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

/** A relação pessoal: o perfume na wishlist ou na coleção de alguém. */
export const entries = pgTable(
  'entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    list: listKind('list').notNull(),
    variantId: text('variant_id'),
    position: integer('position').notNull().default(0),
    rating: personalRating('rating'),
    notes: text('notes'),
    sourceUrl: text('source_url'),
    variantUrl: text('variant_url'),
    volume: text('volume'),
    price: numeric('price', { precision: 10, scale: 2 }),
    currency: text('currency'),
    priceNote: text('price_note'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entries_user_list_idx').on(t.userId, t.list, t.position),
    uniqueIndex('entries_user_product_list_key').on(t.userId, t.productId, t.list),
  ],
);

/** Jobs de importação (mesmo contrato do ImportJobStore; hoje em memória). */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: importStatus('status').notNull().default('queued'),
    input: jsonb('input').$type<{ url: string; identity: { brand?: string; name: string } | null; variantId: string | null }>().notNull(),
    progressStage: text('progress_stage'),
    progressPercent: integer('progress_percent').notNull().default(0),
    result: jsonb('result'),
    error: jsonb('error').$type<{ code: string; message: string }>(),
    attempts: integer('attempts').notNull().default(0),
    ...timestamps,
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('import_jobs_owner_created_idx').on(t.ownerId, t.createdAt), index('import_jobs_status_idx').on(t.status)],
);

export const schema = { users, products, productVariants, productImages, entries, importJobs };
