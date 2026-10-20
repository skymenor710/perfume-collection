import path from 'node:path';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config';
import { applyMigrations, openDb, type DbHandle } from './db/client';
import { createLogger, errorSummary } from './log';
import { createStorage } from './lib/storage';
import { createMailer } from './lib/mail';
import { loadAssets } from './lib/assets';
import { initMonitoring } from './lib/monitoring';
import type { Deps } from './context';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLIENT_DIR = path.join(PROJECT_ROOT, 'dist', 'client');

export interface Runtime {
  deps: Deps;
  handle: DbHandle;
  close(): Promise<void>;
}

/** Assemble les dépendances (utilisé par le serveur et les scripts en ligne de commande). */
export async function bootstrap(options: { config?: Config; migrate?: boolean; clientDir?: string; syncLog?: boolean } = {}): Promise<Runtime> {
  const config = options.config ?? loadConfig();
  initMonitoring(config);
  // Serverless : écriture synchrone du journal (une instance gelée ne perd pas ses dernières lignes).
  const log = createLogger(config.logLevel, options.syncLog ? pino.destination({ dest: 1, sync: true }) : undefined);
  const handle = await openDb(config.databaseUrl, (err) => log.warn({ err: errorSummary(err) }, 'base : connexion inactive interrompue'));
  if (options.migrate ?? config.migrateOnStart) await applyMigrations(handle);
  const deps: Deps = {
    config,
    db: handle.db,
    storage: createStorage(config.storage),
    log,
    mailer: createMailer(config.mail),
    assets: loadAssets(options.clientDir ?? CLIENT_DIR),
  };
  return { deps, handle, close: () => handle.close() };
}
