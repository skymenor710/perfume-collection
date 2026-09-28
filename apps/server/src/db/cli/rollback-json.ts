import path from 'node:path';
import { config } from '../../config';
import { readOfficialSource } from '../../repositories/official-source';
import { redactDbError } from '../client';
import { rollbackToJson } from '../rollback-json';
import { boot, connect, describeTarget, die, flag } from './common';

/**
 * npm run db:rollback-json               ENSAIO: exporta do Postgres e confere; não toca no library.json
 * npm run db:rollback-json -- --confirm  volta de verdade: exporta, confere, ARQUIVA o library.json atual e o substitui
 *
 * Não altera o .env.local: depois, trocar STORAGE_BACKEND=json é um passo separado e consciente. Só lê o banco.
 */
boot();
const url = config.databaseUrl;
const current = readOfficialSource();
console.log(`Fonte oficial registrada: ${current ? `${current.official} (desde ${current.since})` : 'nenhuma (marcador ausente)'}`);
const handle = await connect(url);
try {
  console.log(`Banco: ${describeTarget(url)}`);
  const report = await rollbackToJson(handle.db, config.dataDir, { confirm: flag('confirm') });
  console.log(`Postgres: ${report.counts.users} usuário(s), ${report.counts.products} produtos, ${report.counts.entries} entradas`);
  for (const s of report.steps) console.log(`  · ${s}`);
  if (report.confirmed) {
    console.log(`\nRollback preparado. O library.json anterior está em ${path.relative(config.root, report.archivedLibraryJson ?? '')}.`);
    console.log('Último passo (separado, consciente): STORAGE_BACKEND=json no .env.local e reiniciar o app.');
  } else console.log('\nPara executar de verdade: npm run db:rollback-json -- --confirm');
} catch (error) {
  die(`Rollback interrompido (nada além da exportação foi feito): ${redactDbError(error, url)}`);
} finally {
  await handle.close();
}
