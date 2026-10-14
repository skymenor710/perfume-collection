import type { Config } from './config';
import type { Db } from './db/client';
import type { Logger } from './log';
import type { Storage } from './lib/storage';
import type { Mailer } from './lib/mail';
import type { Assets } from './lib/assets';

/** Dépendances partagées de l'application (injectées : les tests utilisent PGlite en mémoire et un dossier temporaire). */
export interface Deps {
  config: Config;
  db: Db;
  storage: Storage;
  log: Logger;
  mailer: Mailer;
  assets: Assets;
}

export interface SessionInfo {
  id: string;
  adminId: string;
  email: string;
  csrfToken: string;
}

export type AppEnv = {
  Variables: {
    session: SessionInfo | null;
    clientIp: string;
  };
};
