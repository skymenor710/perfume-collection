// Prepara ou limpa o banco do BRANCH DE TESTES do Neon (TEST_DATABASE_URL). Nunca toca no banco principal:
// antes de qualquer comando, confere que o banco de testes é outro ambiente (outro endpoint/branch).
//
//   tsx scripts/neon-test-db.ts reset                    apaga tudo e aplica as migrations (schema em dia, vazio)
//   tsx scripts/neon-test-db.ts smoke <pasta-de-dados>   reset + importa a coleção limpa do smoke (semente)
//   tsx scripts/neon-test-db.ts clean                    apaga os dados de teste e deixa o schema em dia, vazio
//
// Nunca imprime a URL: só host mascarado, pooler e contagens.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';

const [mode, dataDir] = process.argv.slice(2);
if (!['reset', 'smoke', 'clean'].includes(mode ?? '')) throw new Error('uso: neon-test-db.ts reset | smoke <pasta> | clean');

const { readEnvFile } = await import('../apps/server/src/config');
const { checkTestTarget } = await import('../apps/server/src/db/targets');
const file = readEnvFile();
const pick = (k: string) => (process.env[k]?.trim() || file[k] || '').trim();
const url = pick('TEST_DATABASE_URL');
// A MESMA validação do db:targets, antes de qualquer DROP SCHEMA / reset / limpeza. Falhou = aborta, nada roda.
const check = checkTestTarget(pick, { requirePooler: true });
if (!check.ok || !check.test) {
  console.error(`Banco de testes RECUSADO — nenhuma operação destrutiva foi executada:\n  ${check.refusals.join('\n  ')}`);
  process.exit(1);
}
const t = check.test;
console.log(`branch de testes: ${t.host} · ${t.pooled ? 'com pooler' : 'conexão direta'} · banco ${t.database} (separado do principal: conferido)`);

const { applyMigrations, openDb, redactDbError } = await import('../apps/server/src/db/client');
const { migrationStatus } = await import('../apps/server/src/db/status');
const handle = await openDb(url, { max: 2 });
try {
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await applyMigrations(handle);
  const status = await migrationStatus(handle.db);
  if (!status.upToDate) throw new Error(`migrations faltando: ${status.pending.join(', ')}`);
  console.log(`schema em dia (${status.expected.join(', ')}), dados de teste ${mode === 'clean' ? 'removidos' : 'zerados'}`);

  if (mode === 'smoke') {
    if (!dataDir) throw new Error('falta a pasta de dados do smoke');
    process.env.PERFUMES_DATA_DIR = dataDir;
    process.env.STORAGE_BACKEND = 'json';
    const { ensureLocalConfig } = await import('../apps/server/src/config');
    ensureLocalConfig();
    const { loadStore } = await import('../apps/server/src/store');
    loadStore();
    const { importLibrary, validateLibrary } = await import('../apps/server/src/db/importer');
    const { resolveImageFile } = await import('../apps/server/src/db/checks');
    const library = JSON.parse(readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
    const report = await importLibrary(handle.db, validateLibrary(library, resolveImageFile));
    if (!report.ok) throw new Error(`importação do smoke falhou: ${report.message}`);
    console.log(`smoke/neon: ${report.tables.entries.inserted} perfumes importados e verificados no branch de testes`);
  }
} catch (error) {
  console.error(`Falhou: ${redactDbError(error, url)}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
