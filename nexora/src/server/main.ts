import { serve } from '@hono/node-server';
import { bootstrap } from './bootstrap';
import { createApp } from './app';
import { purgeExpiredSessions } from './lib/auth';
import { purgeOld } from './lib/rate-limit';

const runtime = await bootstrap();
const { deps } = runtime;
const { config, log } = deps;

for (const w of config.warnings) log.warn(w);
if (!deps.assets.built) log.warn('Fichiers du navigateur absents : lancez `npm run build` (dist/client).');
if (!config.mail.configured) log.warn({ missing: config.mail.missing }, 'Notification e-mail non configurée : les demandes sont enregistrées sans envoi.');

const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log.info({ port: info.port, env: config.env, storage: config.storage.driver }, `Nexora : ${config.publicUrl}`);
});

// Ménage périodique : sessions expirées, compteurs de limitation anciens.
const housekeeping = setInterval(() => {
  purgeExpiredSessions(deps).catch(() => {});
  purgeOld(deps.db).catch(() => {});
}, 60 * 60 * 1000);
housekeeping.unref();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'arrêt en cours');
  server.close();
  await runtime.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
