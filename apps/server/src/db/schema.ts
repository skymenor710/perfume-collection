import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { OlfactoryProfile } from '@perfumes/core/olfactory';
import type { FieldSource, ImageSource } from '@perfumes/core/perfume';

/**
 * Schema do Postgres (Neon). Mudanças SÓ por migration versionada (`npm run db:generate` → drizzle/NNNN_*.sql).
 *
 *   users ─< entries >─ products ─< product_variants
 *                │            └──< product_images ─> (product_variants)
 *                └──────────────────> (product_variants)   versão escolhida, sempre do MESMO produto
 *
 * - Tudo que é de uma pessoa tem `user_id` (entries, import_jobs; no futuro reservas, compartilhamentos, histórico).
 *   Nenhuma tabela assume um usuário específico.
 * - Produto é catálogo (compartilhável entre pessoas); a entrada é a relação pessoal (lista, versão, posição,
 *   veredito, observação, preço visto).
 * - IDs em texto: os atuais ("mykonos-reflection-r5rx34", "u_…") são preservados — comparação JSON × Postgres é direta.
 * - Dinheiro em numeric(12,2) (nunca ponto flutuante). 12 dígitos porque há preços em rupia (IDR 859000,00).
 * - Volume estruturado: `volume_ml` numérico quando é um volume só; `volume_text` guarda o texto exato ("50/100 ml"
 *   enquanto a versão não foi escolhida) para a ida e volta não perder nada.
 * - Documentos do app (pirâmide olfativa, fontes por campo, fonte da foto) em `json` — preserva o texto exato,
 *   inclusive a ordem das chaves, e a API sai byte a byte igual. Viram `jsonb`/tabelas quando houver consulta.
 * - Imagens guardam a REFERÊNCIA atual ("bottles/…", "media/…"); na FASE 3 viram chaves do R2.
 */

export const visibility = pgEnum('visibility', ['private', 'public']);
export const listKind = pgEnum('list_kind', ['wishlist', 'collection']);
export const personalRating = pgEnum('personal_rating', ['rebuy', 'very_good', 'good', 'do_not_rebuy']);
export const gender = pgEnum('gender', ['masculine', 'feminine', 'unisex']);
export const perfumeOrigin = pgEnum('perfume_origin', ['google-sheet', 'url-import', 'manual']);
export const imageRole = pgEnum('image_role', ['main', 'alternate']);
export const importStatus = pgEnum('import_status', ['queued', 'running', 'waiting_choice', 'succeeded', 'failed', 'cancelled']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const ml = (name: string) => numeric(name, { precision: 7, scale: 2 });

/** Pessoas. A autenticação (Better Auth, FASE 6) cria as próprias tabelas de sessão/conta ligadas a este id. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    avatarRef: text('avatar_ref'),
    bio: text('bio'),
    /** Para o login por e-mail (FASE 6). */
    email: text('email'),
    privacyProfile: visibility('privacy_profile').notNull().default('private'),
    privacyWishlist: visibility('privacy_wishlist').notNull().default('private'),
    privacyCollection: visibility('privacy_collection').notNull().default('private'),
    /** Muda a cada gravação na biblioteca da pessoa (aviso de sincronização entre abas e aparelhos). */
    libraryRevision: bigint('library_revision', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_key').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_key')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check('users_username_format', sql`${t.username} ~ '^[a-z0-9._]{3,30}$'`),
    check('users_bio_length', sql`${t.bio} is null or char_length(${t.bio}) <= 280`),
  ],
);

/** Catálogo: o perfume em si. */
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    brand: text('brand'),
    name: text('name').notNull(),
    concentration: text('concentration'),
    gender: gender('gender'),
    description: text('description'),
    olfactoryProfile: json('olfactory_profile').$type<OlfactoryProfile>(),
    dominantColor: text('dominant_color'),
    dominantColorOverride: text('dominant_color_override'),
    accentColor: text('accent_color'),
    accentGlow: text('accent_glow'),
    model3dRef: text('model_3d_ref'),
    fieldSources: json('field_sources').$type<Record<string, FieldSource>>().notNull(),
    origin: perfumeOrigin('origin').notNull(),
    assetVersion: integer('asset_version').notNull().default(1),
    /** Quem trouxe o produto para o catálogo (proveniência, não posse). Nulo nos dados migrados: não se inventa autor. */
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('products_brand_name_idx').on(sql`lower(${t.brand})`, sql`lower(${t.name})`), check('products_name_not_blank', sql`btrim(${t.name}) <> ''`)],
);

/** Versões que a loja vende (50 ml, 100 ml…). O id é o da loja (ex.: variante Shopify), único dentro do produto. */
export const productVariants = pgTable(
  'product_variants',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    volumeText: text('volume_text'),
    volumeMl: ml('volume_ml'),
    price: money('price'),
    currency: char('currency', { length: 3 }),
    sku: text('sku'),
    available: boolean('available'),
    url: text('url'),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.id] }),
    check('product_variants_price_nonnegative', sql`${t.price} is null or ${t.price} >= 0`),
    check('product_variants_currency_format', sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check('product_variants_volume_positive', sql`${t.volumeMl} is null or ${t.volumeMl} > 0`),
  ],
);

/** Fotos do frasco, em ordem (a principal primeiro). Uma referência aparece uma vez por produto. */
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    role: imageRole('role').notNull(),
    ref: text('ref').notNull(),
    thumbRef: text('thumb_ref'),
    masterRef: text('master_ref'),
    /** Versão que a foto mostra (50 ml ≠ 100 ml); nulo = vale para o produto. Sempre uma versão do MESMO produto. */
    variantId: text('variant_id'),
    transparent: boolean('transparent'),
    source: json('source').$type<ImageSource>(),
    credit: text('credit'),
    /** Hash do conteúdo (dedupe e chave por conteúdo no R2, FASE 3). */
    sha256: char('sha256', { length: 64 }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_images_product_ref_key').on(t.productId, t.ref),
    index('product_images_product_position_idx').on(t.productId, t.position),
    foreignKey({ name: 'product_images_variant_fk', columns: [t.productId, t.variantId], foreignColumns: [productVariants.productId, productVariants.id] }),
  ],
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
    /** Versão escolhida; nulo = ainda não escolheu (ou o produto não tem versões). */
    variantId: text('variant_id'),
    position: integer('position').notNull(),
    rating: personalRating('rating'),
    notes: text('notes'),
    sourceUrl: text('source_url'),
    variantUrl: text('variant_url'),
    volumeText: text('volume_text'),
    volumeMl: ml('volume_ml'),
    price: money('price'),
    currency: char('currency', { length: 3 }),
    priceNote: text('price_note'),
    addedAt: ts('added_at').notNull(),
    acquiredAt: ts('acquired_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    // O mesmo perfume não entra duas vezes na mesma lista da mesma pessoa.
    uniqueIndex('entries_user_product_list_key').on(t.userId, t.productId, t.list),
    index('entries_user_list_position_idx').on(t.userId, t.list, t.position),
    index('entries_product_idx').on(t.productId),
    foreignKey({ name: 'entries_variant_fk', columns: [t.productId, t.variantId], foreignColumns: [productVariants.productId, productVariants.id] }),
    check('entries_price_nonnegative', sql`${t.price} is null or ${t.price} >= 0`),
    check('entries_currency_format', sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check('entries_volume_positive', sql`${t.volumeMl} is null or ${t.volumeMl} > 0`),
    check('entries_notes_length', sql`${t.notes} is null or char_length(${t.notes}) <= 1000`),
  ],
);

/** Jobs de importação (mesmo contrato do ImportJobStore; nesta fase o runner continua em memória). */
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
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('import_jobs_owner_created_idx').on(t.ownerId, t.createdAt),
    index('import_jobs_status_idx').on(t.status),
    check('import_jobs_progress_range', sql`${t.progressPercent} between 0 and 100`),
  ],
);

export const schema = { users, products, productVariants, productImages, entries, importJobs };
