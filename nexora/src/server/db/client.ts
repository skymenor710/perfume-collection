import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { schema } from './schema';

/**
 * Connexion PostgreSQL.
 *   postgres://…        PostgreSQL réel (Neon, Supabase, serveur dédié) — pilote `pg`
 *   pglite:<dossier>    PostgreSQL embarqué (PGlite) persistant dans un dossier — développement / serveur unique
 *   pglite:memory       en mémoire — tests
 * L'URL n'est jamais journalisée.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export async function openDb(url: string, onPoolError?: (err: Error) => void): Promise<DbHandle> {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    let client;
    if (target === 'memory' || target === '') client = new PGlite();
    else {
      const dir = path.resolve(target);
      mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    return { db: drizzle(client, { schema }) as unknown as Db, kind: 'pglite', close: () => client.close() };
  }
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const connectionString = pgConnectionString(url);
  const pool = new Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000, keepAlive: true });
  // Erreur d'une connexion inactive (base mise en veille, coupure réseau) : `pg` la retire du pool ; on la signale sans
  // arrêter le processus.
  pool.on('error', (err) => onPoolError?.(err));
  return { db: drizzle(pool, { schema }) as unknown as Db, kind: 'postgres', close: () => pool.end() };
}

export async function applyMigrations(handle: DbHandle): Promise<void> {
  if (handle.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

/** URL de connexion PostgreSQL normalisée (TLS). */
export function pgConnectionString(url: string): string {
  // sslmode=require → vérification complète du certificat (comportement sûr, indépendant de la version de `pg`).
  // Sans sslmode, un hôte distant est aussi joint en TLS vérifié (`pg` se connecterait sinon EN CLAIR) ; hôte local
  // ou de réseau privé (localhost, 127.0.0.1, 10.x, 192.168.x, conteneur « db », *.internal) : inchangé.
  // `sslmode=disable` explicite reste respecté.
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const local =
      !host || host === 'localhost' || !host.includes('.') || u.searchParams.has('host') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /\.(local|internal|lan)$/.test(host);
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca' || (!mode && !local)) u.searchParams.set('sslmode', 'verify-full');
    return u.toString();
  } catch {
    return url;
  }
}
