import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { openDb, redactDbError, type DbHandle } from '../db/client';
import { loadLibrary } from '../db/snapshot';
import { migrationStatus } from '../db/status';
import { event, log } from '../log';
import { mediaSettings, seedRefs } from '../media/content';
import { loadStore, readPerfumes, store } from '../store';
import type { LibraryRepository } from './library';
import { PostgresLibraryRepository } from './postgres';
import { jsonStartRefusal, markPostgresOfficial } from './official-source';
import { seedUpgrades } from './rules';

/**
 * Escolhe a fonte oficial da biblioteca por `STORAGE_BACKEND` — o ÚNICO lugar do servidor que sabe que existem duas.
 *
 *   json      data/library.json (como sempre foi)
 *   postgres  DATABASE_URL; exige as migrations aplicadas e um dono no banco. Se algo faltar, a partida PARA com a
 *             explicação — nunca cai em silêncio para o JSON (seriam duas fontes de verdade divergindo).
 */

export class StartupError extends Error {}

export interface OpenedLibrary {
  repo: LibraryRepository;
  close(): Promise<void>;
  /** Presente no backend postgres (cópias de segurança). */
  db?: DbHandle;
}

export async function openLibraryRepository(): Promise<OpenedLibrary> {
  if (config.storageBackend === 'json') {
    // Postgres já é a fonte oficial? Então o library.json está parado: recusa, sem tocar em nada.
    const refusal = jsonStartRefusal();
    if (refusal) throw new StartupError(refusal);
    loadStore();
    return { repo: store, close: async () => {} };
  }
  let handle: DbHandle;
  try {
    handle = await openDb(config.databaseUrl);
  } catch (error) {
    throw new StartupError(`Não consegui abrir o banco: ${redactDbError(error, config.databaseUrl)}`);
  }
  try {
    const status = await migrationStatus(handle.db);
    if (!status.upToDate) throw new StartupError(`O banco não está com todas as migrations (faltam: ${status.pending.join(', ') || '?'}). Rode \`npm run db:migrate\`.`);
    const repo = await PostgresLibraryRepository.open(handle.db, config.ownerId);
    // Banco aberto, em dia e com dono: o Postgres é a fonte oficial (protege contra voltar ao JSON parado).
    markPostgresOfficial();
    // Mesma regra do JSON: perfumes da planilha recebem o que a semente reprocessada trouxe de novo.
    try {
      // Pelo mapa de migração: foto da semente já no R2 continua sendo a mesma foto (nada volta para bottles/).
      const upgrades = seedUpgrades(await repo.list(), readPerfumes(config.seedFile), seedRefs(mediaSettings()));
      for (const next of upgrades) await repo.upsert(next);
      if (upgrades.length) event('library.upgraded', { upgraded: upgrades.length });
    } catch (error) {
      log.warn({ event: 'library.upgraded', err: redactDbError(error, config.databaseUrl) });
    }
    return { repo, db: handle, close: () => handle.close() };
  } catch (error) {
    await handle.close().catch(() => {});
    if (error instanceof StartupError) throw error;
    throw new StartupError(redactDbError(error, config.databaseUrl));
  }
}

/**
 * Cópia de segurança do Postgres no formato do data/library.json (data/backups/postgres/, uma por partida e uma por
 * dia de servidor ligado). É o caminho de volta: com ela, STORAGE_BACKEND=json volta a funcionar com os dados de
 * hoje. Nenhuma cópia é apagada automaticamente (são pequenas; limpar é decisão do dono).
 */
export async function backupLibraryFromDb(handle: DbHandle): Promise<string> {
  const dir = path.join(config.dataDir, 'backups', 'postgres');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `library-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(await loadLibrary(handle.db), null, 2)}\n`, { flag: 'wx' });
  return file;
}
