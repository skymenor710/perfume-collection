import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Comptes d'administration. Aucun compte n'est créé automatiquement : `npm run admin:create`. */
export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Sessions côté serveur. L'identifiant stocké est l'empreinte SHA-256 du jeton du cookie, jamais le jeton. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_admin_idx').on(t.adminId), index('sessions_expires_idx').on(t.expiresAt)],
);

export interface ImageVariant {
  width: number;
  height: number;
  format: 'avif' | 'webp';
  key: string;
  bytes: number;
}

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    category: text('category').notNull().default(''),
    description: text('description').notNull().default(''),
    url: text('url'),
    /** Étude de cas : contexte / défi, solution apportée, résultats mesurables (texte simple). */
    challenge: text('challenge').notNull().default(''),
    solution: text('solution').notNull().default(''),
    results: text('results').notNull().default(''),
    /** Lien vers l'étude de cas complète (page, article, PDF) — facultatif. */
    caseUrl: text('case_url'),
    isDemo: boolean('is_demo').notNull().default(false),
    published: boolean('published').notNull().default(false),
    /** 1, 2 ou 3 : position sur la page d'accueil. NULL = pas mis en avant. */
    featuredPosition: smallint('featured_position'),
    sortOrder: integer('sort_order').notNull().default(0),
    coverImageId: uuid('cover_image_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_featured_position_uq').on(t.featuredPosition).where(sql`${t.featuredPosition} is not null`),
    check('projects_featured_position_ck', sql`${t.featuredPosition} is null or ${t.featuredPosition} between 1 and 3`),
    index('projects_sort_idx').on(t.sortOrder),
  ],
);

export const projectImages = pgTable(
  'project_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    alt: text('alt').notNull().default(''),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Préfixe de stockage : tous les fichiers de l'image (variantes + maître) vivent sous ce préfixe. */
    storagePrefix: text('storage_prefix').notNull(),
    variants: jsonb('variants').$type<ImageVariant[]>().notNull(),
    bytes: integer('bytes').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('project_images_project_idx').on(t.projectId, t.sortOrder)],
);

/** Contenus éditables du site (une ligne par bloc, valeur validée par Zod côté serveur). */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

export const contactRequests = pgTable(
  'contact_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    name: text('name').notNull(),
    company: text('company'),
    email: text('email').notNull(),
    phone: text('phone'),
    projectType: text('project_type').notNull(),
    /** Facultatifs : budget estimatif et délai souhaité (listes fermées, voir lib/content.ts). */
    budget: text('budget'),
    timeline: text('timeline'),
    message: text('message').notNull(),
    status: text('status', { enum: ['new', 'in_progress', 'done'] }).notNull().default('new'),
    /** Horodatage de l'acceptation de la notice d'information (pas un consentement marketing). */
    privacyAckAt: timestamp('privacy_ack_at', { withTimezone: true }).notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifyError: text('notify_error'),
  },
  (t) => [
    index('contact_requests_status_idx').on(t.status, t.createdAt),
    check('contact_requests_status_ck', sql`${t.status} in ('new','in_progress','done')`),
  ],
);

/** Compteurs de limitation de débit (fenêtre fixe), partagés entre instances. */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
});

/** Version du contenu public : incrémentée à chaque modification dans l'admin (invalidation du cache). */
export const contentVersion = pgTable('content_version', {
  id: smallint('id').primaryKey().default(1),
  version: integer('version').notNull().default(1),
  updatedAt: updatedAt(),
});

/** Journal des actions d'administration (qui, quoi, quand) — sans contenu personnel. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);

export const schema = { admins, sessions, projects, projectImages, siteSettings, contactRequests, rateLimits, contentVersion, auditLog };
