import { sql } from 'drizzle-orm';
import { applyMigrations, redactDbError } from '../client';
import { migrationStatus } from '../status';
import { boot, connect, describeTarget, die, flag, requireBackupBeforeWrite, targetUrl, writeReport } from './common';

/**
 * npm run db:migrate            aplica as migrations versionadas (drizzle/*.sql) que faltam
 * npm run db:migrate -- --status  só mostra o que está aplicado
 */
boot();
const url = targetUrl('migrate');
const handle = await connect(url);
try {
  const before = await migrationStatus(handle.db);
  const version = (await handle.db.execute(sql`show server_version`)) as unknown as { rows: { server_version: string }[] };
  console.log(`Banco: ${describeTarget(url)}`);
  console.log(`Conexão: OK · PostgreSQL ${version.rows[0]?.server_version ?? '?'}`);
  console.log(`Migrations no repositório: ${before.expected.join(', ')}`);
  console.log(`Aplicadas: ${before.applied} · pendentes: ${before.pending.join(', ') || 'nenhuma'}`);
  if (flag('status') || before.upToDate) {
    if (before.upToDate) console.log('Nada a aplicar.');
  } else {
    requireBackupBeforeWrite(url);
    await applyMigrations(handle);
    const after = await migrationStatus(handle.db);
    if (!after.upToDate) die(`Depois de aplicar, ainda faltam: ${after.pending.join(', ')}`);
    console.log(`Aplicadas agora: ${before.pending.join(', ')}. Banco em dia.`);
    console.log(`Relatório: ${writeReport('migrate', { target: describeTarget(url), before, after, at: new Date().toISOString() })}`);
  }
} catch (error) {
  die(`Migration falhou (a transação da migration foi desfeita): ${redactDbError(error, url)}`);
} finally {
  await handle.close();
}
