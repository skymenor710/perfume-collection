import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, ConfigError, ensureLocalConfig } from '../../config';
import { openDb, redactDbError, type DbHandle } from '../client';

/**
 * Base dos comandos `npm run db:*`. A URL vem SÓ do ambiente/.env.local (nunca da linha de comando, que fica no
 * histórico do terminal) e nunca é impressa: o que aparece é o tipo do banco e o host.
 */

export const args = process.argv.slice(2);
export const flag = (name: string) => args.includes(`--${name}`);
export const option = (name: string, fallback: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/** Identificação desta migração (relatórios e baselines ficam agrupados por ela). */
export const MIGRATION_ID = option('migration-id', 'fase2-20260927');

export function boot(): void {
  try {
    ensureLocalConfig();
  } catch (error) {
    if (error instanceof ConfigError) die(error.message);
    throw error;
  }
}

export function die(message: string, code = 1): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(code);
}

export function describeTarget(url: string): string {
  if (url.startsWith('pglite:')) return `PGlite local (${url.slice('pglite:'.length) || 'memória'})`;
  try {
    return `Postgres em ${new URL(url).host}`;
  } catch {
    return 'Postgres';
  }
}

export async function connect(url: string): Promise<DbHandle> {
  if (!url) die('DATABASE_URL não está definida. Coloque a URL do Neon no .env.local (modelo em .env.example) — nunca no código nem no Git.');
  try {
    return await openDb(url, { max: 2 });
  } catch (error) {
    die(`Não consegui conectar: ${redactDbError(error, url)}`);
  }
}

/** Relatório em data/migrations/<id>/ (fora do Git), com nome único — nunca sobrescreve um anterior. */
export function writeReport(step: string, data: unknown): string {
  const dir = path.join(config.dataDir, 'migrations', MIGRATION_ID);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${step}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  return path.relative(config.root, file);
}

export const BASELINE_FILE = path.join('docs', 'state', MIGRATION_ID, 'baseline.pre-fase2.json');
export const API_SNAPSHOT_FILE = path.join('docs', 'state', MIGRATION_ID, 'api-perfumes.pre-fase2.json');

export function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]!);
  const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(width[i]!)).join('  ');
  return [line(keys), line(width.map((w) => '─'.repeat(w))), ...rows.map((r) => line(keys.map((k) => String(r[k]))))].join('\n');
}
