import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { schema } from './schema';

/**
 * Conexão com o Postgres. Dois tipos de endereço:
 *
 *   postgres://…            Postgres de verdade (Neon em produção/staging/dev) — driver `pg`, TLS pelo `sslmode`
 *   pglite:<pasta>           Postgres local embutido (PGlite: o próprio Postgres compilado para WebAssembly), gravado
 *   pglite:memory            numa pasta ou só em memória — para ensaio da migração e testes, sem conta nem serviço
 *
 * A URL nunca vai para log nem para mensagem de erro (`redactDbError`).
 */

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function isPgliteUrl(url: string) {
  return url.startsWith('pglite:');
}

/**
 * TLS do driver `pg`, fixado explicitamente (só em memória: o .env.local e as credenciais não mudam).
 *
 * - `sslmode=require|prefer|verify-ca` → `verify-full`. Hoje o `pg` 8 já trata esses modos como `verify-full`
 *   (confere certificado e nome do host); no `pg` 9 eles passam à semântica do libpq, em que `require` NÃO confere o
 *   certificado. Fixar aqui mantém a proteção de hoje numa atualização futura — e não enfraquece nada agora.
 *   `disable`/`allow`, `verify-full` e URLs sem sslmode ficam como estão.
 * - `channel_binding=require` → `enableChannelBinding: true`. O `pg` ignora esse parâmetro na URL; a ligação do
 *   SCRAM ao canal TLS (SCRAM-SHA-256-PLUS) só liga pela opção.
 */
export function pgConnectionOptions(url: string): { connectionString: string; enableChannelBinding?: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { connectionString: url };
  }
  const mode = parsed.searchParams.get('sslmode');
  if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') parsed.searchParams.set('sslmode', 'verify-full');
  const channelBinding = parsed.searchParams.get('channel_binding') === 'require';
  return { connectionString: parsed.toString(), ...(channelBinding ? { enableChannelBinding: true } : {}) };
}

export async function openDb(url: string, options: { max?: number } = {}): Promise<DbHandle> {
  if (isPgliteUrl(url)) {
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
  const pool = new Pool({ ...pgConnectionOptions(url), max: options.max ?? 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  // Erro de conexão ociosa (rede caiu, Neon suspendeu): não derruba o processo; o próximo pedido reconecta.
  pool.on('error', () => {});
  return { db: drizzle(pool, { schema }) as unknown as Db, kind: 'postgres', close: () => pool.end() };
}

/** Aplica as migrations versionadas (as mesmas em todo ambiente). */
export async function applyMigrations(handle: DbHandle): Promise<void> {
  if (handle.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
    return;
  }
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Mensagem de erro sem credenciais: tira a URL inteira, usuário e senha, e qualquer "postgres://…" que apareça.
 * O host continua (ajuda a diagnosticar), a senha nunca.
 */
export function redactDbError(error: unknown, url = ''): string {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = new Set<string>();
  if (url) {
    secrets.add(url);
    try {
      const u = new URL(url);
      if (u.password) {
        secrets.add(u.password);
        secrets.add(decodeURIComponent(u.password));
      }
      if (u.username) secrets.add(`"${decodeURIComponent(u.username)}"`);
    } catch {
      /* não é URL: some inteira mesmo assim */
    }
  }
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) if (s) message = message.split(s).join('[removido]');
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[removido]');
}
