// Prepara o banco do smoke com backend Postgres: a mesma coleção limpa que o smoke JSON usa (a semente, com um dono),
// migrations versionadas e importação verificada num PGlite dentro da pasta temporária do teste.
// Uso interno: tsx scripts/smoke-prepare-pg.ts <pasta-de-dados>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dataDir = process.argv[2];
if (!dataDir) throw new Error('uso: smoke-prepare-pg.ts <pasta-de-dados>');
process.env.PERFUMES_DATA_DIR = dataDir;
process.env.STORAGE_BACKEND = 'json';

const { ensureLocalConfig } = await import('../apps/server/src/config');
ensureLocalConfig();
const { loadStore } = await import('../apps/server/src/store');
loadStore(); // grava data/library.json a partir da semente, como o servidor faria

const { applyMigrations, openDb } = await import('../apps/server/src/db/client');
const { importLibrary, validateLibrary } = await import('../apps/server/src/db/importer');
const { resolveImageFile } = await import('../apps/server/src/db/checks');
const handle = await openDb(`pglite:${path.join(dataDir, 'pg')}`);
try {
  await applyMigrations(handle);
  const library = JSON.parse(readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
  const report = await importLibrary(handle.db, validateLibrary(library, resolveImageFile));
  if (!report.ok) throw new Error(`importação do smoke falhou: ${report.message}\n${report.validation.problems.join('\n')}`);
  console.log(`smoke/postgres: ${report.tables.entries.inserted} perfumes importados e verificados`);
} finally {
  await handle.close();
}
