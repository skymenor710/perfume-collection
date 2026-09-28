import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { MIGRATIONS_FOLDER } from './client';

/** Migrations do repositório (drizzle/meta/_journal.json), na ordem. */
export function journalMigrations(): { tag: string; when: number }[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
  return journal.entries.map((e) => ({ tag: e.tag, when: e.when }));
}

export interface MigrationStatus {
  expected: string[];
  applied: number;
  pending: string[];
  upToDate: boolean;
}

/** Quantas migrations do repositório já estão no banco (tabela do drizzle). Banco sem a tabela = nenhuma. */
export async function migrationStatus(db: Db): Promise<MigrationStatus> {
  const expected = journalMigrations();
  let appliedWhen: number[] = [];
  try {
    const result = (await db.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at`)) as unknown as { rows: { created_at: string | number }[] };
    appliedWhen = result.rows.map((r) => Number(r.created_at));
  } catch {
    appliedWhen = [];
  }
  const pending = expected.filter((m) => !appliedWhen.includes(m.when)).map((m) => m.tag);
  return { expected: expected.map((m) => m.tag), applied: appliedWhen.length, pending, upToDate: pending.length === 0 && appliedWhen.length === expected.length };
}
