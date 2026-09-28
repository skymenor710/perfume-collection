import { config } from '../../config';
import { applyMigrations, redactDbError } from '../client';
import { migrationStatus } from '../status';
import { boot, connect, describeTarget, die, flag, writeReport } from './common';

/**
 * npm run db:migrate            aplica as migrations versionadas (drizzle/*.sql) que faltam
 * npm run db:migrate -- --status  só mostra o que está aplicado
 */
boot();
const url = config.migrationDatabaseUrl;
const handle = await connect(url);
try {
  const before = await migrationStatus(handle.db);
  console.log(`Banco: ${describeTarget(url)}`);
  console.log(`Migrations no repositório: ${before.expected.join(', ')}`);
  console.log(`Aplicadas: ${before.applied} · pendentes: ${before.pending.join(', ') || 'nenhuma'}`);
  if (flag('status') || before.upToDate) {
    if (before.upToDate) console.log('Nada a aplicar.');
  } else {
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
