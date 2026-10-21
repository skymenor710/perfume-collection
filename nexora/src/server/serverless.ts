import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { bootstrap, type Runtime } from './bootstrap';
import { createApp } from './app';
import { purgeExpiredSessions } from './lib/auth';
import { purgeOld } from './lib/rate-limit';
import { retryNotifications } from './lib/notify';
import { captureException, flushMonitoring } from './lib/monitoring';
import type { AppEnv } from './context';

/**
 * Exécution en fonctions serverless (Netlify) : la MÊME application Hono que le serveur Node (routes, sécurité,
 * formulaire, admin), créée une fois par instance puis réutilisée. Les fichiers statiques (dist/client) sont servis
 * par le CDN ; la fonction n'a besoin que du manifeste Vite et du CSS (intégré à chaque page, autorisé par son
 * empreinte CSP) — voir netlify.toml › included_files.
 */

/** Réglages incompatibles avec des instances éphémères et multiples : la fonction refuse de démarrer. */
export function serverlessProblems(env: NodeJS.ProcessEnv = process.env) {
  const problems: string[] = [];
  const db = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(db)) {
    problems.push('DATABASE_URL doit pointer vers PostgreSQL (Neon, Netlify DB…) : PGlite et le disque local ne sont pas persistants en serverless.');
  }
  if (env.STORAGE_DRIVER !== 's3') {
    problems.push('STORAGE_DRIVER=s3 est obligatoire (Cloudflare R2, Scaleway Object Storage…) : le disque d’une fonction est éphémère.');
  }
  if ((env.SESSION_SECRET ?? '').length < 32) {
    problems.push('SESSION_SECRET (32 caractères minimum) est obligatoire : sans lui, chaque instance tire son propre secret (sessions, jetons du formulaire et limitation de débit incohérents).');
  }
  if (env.TRUST_PROXY === 'true') {
    problems.push('TRUST_PROXY doit rester désactivé : l’IP du visiteur est fournie par la plateforme (context.ip).');
  }
  return problems;
}

function findClientDir() {
  const candidates = [
    process.env.NEXORA_CLIENT_DIR,
    path.resolve(process.cwd(), 'dist/client'),
    process.env.LAMBDA_TASK_ROOT ? path.resolve(process.env.LAMBDA_TASK_ROOT, 'dist/client') : undefined,
  ].filter((d): d is string => !!d);
  return candidates.find((d) => existsSync(path.join(d, 'manifest.json')) || existsSync(path.join(d, '.vite', 'manifest.json')))
    ?? path.resolve(process.cwd(), 'dist/client');
}

interface Instance {
  app: Hono<AppEnv>;
  runtime: Runtime;
}
let instance: Promise<Instance> | null = null;

export function serverlessApp(): Promise<Instance> {
  instance ??= (async () => {
    const problems = serverlessProblems();
    if (problems.length) throw new Error(problems.join(' '));
    const runtime = await bootstrap({ clientDir: findClientDir(), migrate: false, syncLog: true });
    const { deps } = runtime;
    if (!deps.assets.built) throw new Error('Fichiers du navigateur introuvables (dist/client/manifest.json) : vérifier included_files.');
    for (const w of deps.config.warnings) deps.log.warn(w);
    if (deps.config.uploadMaxBytes > 5 * 1024 * 1024) deps.log.warn('UPLOAD_MAX_MB > 5 : les requêtes des fonctions Netlify sont limitées à 6 Mo.');
    return { app: createApp(deps), runtime };
  })().catch((e) => {
    captureException(e, { stage: 'startup' });
    void flushMonitoring();
    instance = null; // nouvel essai à la requête suivante
    throw e;
  });
  return instance;
}

/** Tâche horaire (fonction planifiée) : sessions expirées, compteurs de limitation anciens, notifications en échec. */
export async function housekeeping() {
  const { runtime } = await serverlessApp();
  await purgeExpiredSessions(runtime.deps);
  await purgeOld(runtime.deps.db);
  await retryNotifications(runtime.deps);
}
