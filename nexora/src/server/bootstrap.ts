import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config';
import { applyMigrations, openDb, type DbHandle } from './db/client';
import { createLogger } from './log';
import { createStorage } from './lib/storage';
import { createMailer } from './lib/mail';
import { loadAssets } from './lib/assets';
import type { Deps } from './context';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLIENT_DIR = path.join(PROJECT_ROOT, 'dist', 'client');

export interface Runtime {
  deps: Deps;
  handle: DbHandle;
  close(): Promise<void>;
}

/** Assemble les dépendances (utilisé par le serveur et les scripts en ligne de commande). */
export async function bootstrap(options: { config?: Config; migrate?: boolean; clientDir?: string } = {}): Promise<Runtime> {
  const config = options.config ?? loadConfig();
  const log = createLogger(config.logLevel);
  const handle = await openDb(config.databaseUrl);
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
