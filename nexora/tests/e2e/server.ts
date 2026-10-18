import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Lance le VRAI serveur (build de production) dans un processus séparé, pour pouvoir le redémarrer pendant les tests
 * (persistance). Base : E2E_DATABASE_URL (PostgreSQL) si fournie, sinon PGlite dans un dossier temporaire.
 */
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE = `http://localhost:${PORT}`;
export const ADMIN = { email: 'e2e@nexora.test', password: 'E2E-Mot-De-Passe-Solide-2026' };
const ROOT = path.resolve(import.meta.dirname, '../..');
const work = mkdtempSync(path.join(tmpdir(), 'nexora-e2e-'));

export const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  PUBLIC_URL: BASE,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? `pglite:${path.join(work, 'db')}`,
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: path.join(work, 'uploads'),
  SESSION_SECRET: 'e2e-secret-'.padEnd(48, 'z'),
  MIGRATE_ON_START: 'true',
  MAIL_PROVIDER: 'none',
  LOG_LEVEL: 'warn',
};

let child: ChildProcess | null = null;

function run(args: string[], input?: string) {
  return execFileSync(process.execPath, ['--import', 'tsx', ...args], { cwd: ROOT, env, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

export async function prepare() {
  // Chaque fichier de tests repart d'un état connu (base et images).
  rmSync(path.join(work, 'uploads'), { recursive: true, force: true });
  if (env.DATABASE_URL!.startsWith('pglite:')) rmSync(path.join(work, 'db'), { recursive: true, force: true });
  if (env.DATABASE_URL!.startsWith('postgres')) {
    // Base PostgreSQL dédiée aux tests : remise à zéro complète.
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await pool.end();
  }
  run(['scripts/seed.ts']);
  run(['scripts/create-admin.ts', '--email', ADMIN.email], `${ADMIN.password}\n`);
}

export async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Le serveur n’a pas démarré');
}

export async function stop() {
  if (!child) return;
  const c = child;
  child = null;
  await new Promise<void>((resolve) => {
    c.once('exit', () => resolve());
    c.kill('SIGTERM');
  });
}
