import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Configuration lue UNE fois depuis l'environnement et validée.
 * Les secrets ne sortent jamais du serveur : aucune de ces valeurs n'est envoyée au navigateur
 * (le seul élément public est `publicUrl`).
 */
const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1).default('pglite:./data/db'),
  MIGRATE_ON_START: bool,

  SESSION_SECRET: z.string().optional(),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./data/uploads'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MAIL_PROVIDER: z.enum(['none', 'resend', 'brevo']).default('none'),
  MAIL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_TO: z.string().optional(),

  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(12),
  /**
   * Mesure d'audience (facultative) : chargée UNIQUEMENT après consentement du visiteur (bandeau). none = aucun outil
   * tiers ; les événements de conversion restent émis localement (window, « nexora:track ») sans rien envoyer.
   */
  ANALYTICS_PROVIDER: z.enum(['none', 'plausible']).default('none'),
  ANALYTICS_DOMAIN: z.string().trim().max(200).optional(),
  ANALYTICS_SCRIPT_URL: z.string().url().startsWith('https://').default('https://plausible.io/js/script.manual.js'),
});

export type Env = z.infer<typeof schema>;

export interface Config {
  env: Env['NODE_ENV'];
  isProd: boolean;
  analytics: { provider: 'plausible'; domain: string; scriptUrl: string; origin: string } | null;
  host: string;
  port: number;
  publicUrl: string;
  publicOrigin: string;
  trustProxy: boolean;
  logLevel: Env['LOG_LEVEL'];
  databaseUrl: string;
  migrateOnStart: boolean;
  sessionSecret: string;
  cookieSecure: boolean;
  storage:
    | { driver: 'local'; dir: string }
    | { driver: 's3'; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  mail: { provider: 'none' | 'resend' | 'brevo'; apiKey?: string; from?: string; to?: string; configured: boolean; missing: string[] };
  uploadMaxBytes: number;
  warnings: string[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Les chaînes vides du .env valent « non renseigné ».
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide : ${fields}. Voir .env.example.`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const warnings: string[] = [];

  let sessionSecret = e.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (isProd) throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum) en production.');
    // Développement uniquement : secret éphémère (les sessions sont perdues au redémarrage).
    sessionSecret = randomBytes(32).toString('base64url');
    warnings.push('SESSION_SECRET absent : secret temporaire généré (développement uniquement).');
  }

  const publicUrl = e.PUBLIC_URL.replace(/\/+$/, '');
  const cookieSecure = e.COOKIE_SECURE === 'auto' ? publicUrl.startsWith('https://') : e.COOKIE_SECURE === 'true';
  if (isProd && !cookieSecure) warnings.push('Cookies sans attribut Secure : PUBLIC_URL doit être en https en production.');

  let storage: Config['storage'];
  if (e.STORAGE_DRIVER === 's3') {
    const missing = (['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`Stockage S3 incomplet : ${missing.join(', ')}.`);
    storage = {
      driver: 's3',
      endpoint: e.S3_ENDPOINT!.replace(/\/+$/, ''),
      region: e.S3_REGION,
      bucket: e.S3_BUCKET!,
      accessKeyId: e.S3_ACCESS_KEY_ID!,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
    };
  } else {
    storage = { driver: 'local', dir: e.STORAGE_LOCAL_DIR };
    if (isProd) warnings.push('Stockage local : le dossier STORAGE_LOCAL_DIR doit être sur un disque persistant (pas un disque temporaire).');
  }
  if (isProd && e.DATABASE_URL.startsWith('pglite:')) {
    warnings.push('Base PGlite embarquée en production : réservé à un serveur unique avec disque persistant. Préférez PostgreSQL.');
  }

  const mailMissing: string[] = [];
  if (e.MAIL_PROVIDER === 'none') mailMissing.push('MAIL_PROVIDER');
  else {
    if (!e.MAIL_API_KEY) mailMissing.push('MAIL_API_KEY');
    if (!e.MAIL_FROM) mailMissing.push('MAIL_FROM');
    if (!e.MAIL_TO) mailMissing.push('MAIL_TO');
  }

  return {
    env: e.NODE_ENV,
    isProd,
    analytics:
      e.ANALYTICS_PROVIDER === 'plausible' && e.ANALYTICS_DOMAIN
        ? { provider: 'plausible', domain: e.ANALYTICS_DOMAIN, scriptUrl: e.ANALYTICS_SCRIPT_URL, origin: new URL(e.ANALYTICS_SCRIPT_URL).origin }
        : null,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    publicOrigin: new URL(publicUrl).origin,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    migrateOnStart: e.MIGRATE_ON_START,
    sessionSecret,
    cookieSecure,
    storage,
    mail: {
      provider: e.MAIL_PROVIDER,
      apiKey: e.MAIL_API_KEY,
      from: e.MAIL_FROM,
      to: e.MAIL_TO,
      configured: mailMissing.length === 0,
      missing: mailMissing,
    },
    uploadMaxBytes: Math.round(e.UPLOAD_MAX_MB * 1024 * 1024),
    warnings,
  };
}
