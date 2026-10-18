// Essai local des fonctions Netlify, empaquetées comme sur Netlify (esbuild, modules natifs externes) :
// configuration refusée, pages, en-têtes de sécurité, formulaire réellement enregistré, limitation par IP fournie par
// la plateforme, X-Forwarded-For falsifié ignoré, fonction planifiée de ménage.
//   NETLIFY_TEST_DATABASE_URL=postgres://… npm run test:netlify      (base PostgreSQL de test, migrée par le script)
// Aucun appel réseau externe : le stockage S3 est configuré sur une adresse invalide (non utilisée par ces essais).
import { execFileSync } from 'node:child_process';

const DB = process.env.NETLIFY_TEST_DATABASE_URL;
if (!DB) {
  console.error('NETLIFY_TEST_DATABASE_URL manquant (base PostgreSQL de test).');
  process.exit(2);
}
const bundle = (entry, out) =>
  execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=esm', '--target=node22', '--external:sharp', '--external:pg',
    '--external:@electric-sql/pglite', `--outfile=${out}`, '--log-level=warning',
    "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"], { stdio: 'inherit' });
bundle('netlify/functions/site.mts', '.netlify/test/site.mjs');
bundle('netlify/functions/menage.mts', '.netlify/test/menage.mjs');
// Variables du test (valeurs factices, aucun secret réel).
const env = {
  NODE_ENV: 'production', PUBLIC_URL: 'https://nexora.example', SESSION_SECRET: 'x'.repeat(48),
  DATABASE_URL: DB, STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://s3.invalid', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', LOG_LEVEL: 'warn', UPLOAD_MAX_MB: '4',
};
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'OK ' : 'ÉCHEC', name, extra]); };

execFileSync('node', ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit', env: { ...process.env, ...env, NETLIFY: 'true' } });

// 1. Configuration refusée (PGlite) → 503 neutre
process.env.DATABASE_URL = 'pglite:./data/db';
process.env.STORAGE_DRIVER = 'local';
const mod = await import(process.cwd() + '/.netlify/test/site.mjs?bad');
const bad = await mod.default(new Request('https://nexora.example/'), { ip: '203.0.113.1' });
ok('config PGlite refusée → 503', bad.status === 503, String(bad.status));

// 2. Bonne configuration (nouvelle instance du module)
Object.assign(process.env, env);
const { default: handler, config } = await import(process.cwd() + '/.netlify/test/site.mjs?good');
ok('config de route', config.path === '/*' && config.preferStatic === true);
const home = await handler(new Request('https://nexora.example/'), { ip: '203.0.113.10' });
const html = await home.text();
ok('GET / → 200', home.status === 200, String(home.status));
ok('CSP stricte', /script-src 'self'/.test(home.headers.get('content-security-policy') ?? ''));
ok('HSTS (https)', !!home.headers.get('strict-transport-security'));
ok('CSS intégré (manifeste trouvé)', html.includes('<style>') && html.includes('.gallery__viewport'));
ok('h1 création de sites', html.includes('Création de sites web'));
ok('JSON-LD zone', html.includes('"areaServed"') && html.includes('Blois'));
const health = await handler(new Request('https://nexora.example/healthz'), { ip: '203.0.113.10' });
ok('GET /healthz → 200', health.status === 200, String(health.status));
const robots = await handler(new Request('https://nexora.example/robots.txt'), {});
ok('robots.txt', (await robots.text()).includes('Sitemap: https://nexora.example/sitemap.xml'));
const admin = await handler(new Request('https://nexora.example/admin'), {});
ok('admin sans session → redirection connexion', admin.status === 302 || admin.status === 303, String(admin.status));

// 3. Formulaire : jeton de la page, envoi après 2,6 s, enregistrement réel
const token = /name="token" value="([^"]+)"/.exec(html)?.[1];
await new Promise((r) => setTimeout(r, 2600));
const body = new URLSearchParams({ token, website: '', name: 'Test Netlify', email: 'test@example.com', projectType: 'Création de site vitrine', message: 'Message de test du paquet Netlify.' });
const post = (ip) => handler(new Request('https://nexora.example/contact', { method: 'POST', headers: { origin: 'https://nexora.example', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body }), { ip });
const sent = await post('203.0.113.20');
ok('POST /contact → 201', sent.status === 201, `${sent.status} ${await sent.text()}`);

// 4. Limitation par IP fournie par la plateforme : 5 envois / 15 min pour une IP, une autre IP n'est pas bloquée
const allowed = [];
for (let i = 0; i < 5; i++) allowed.push((await post('203.0.113.30')).status);
ok('5 envois même IP → acceptés', allowed.every((s) => s === 201), allowed.join(','));
const blocked = await post('203.0.113.30');
ok('6e envoi même IP → 429', blocked.status === 429, String(blocked.status));
const other = await post('203.0.113.31');
ok('autre IP → acceptée', other.status === 201, String(other.status));
// En-tête X-Forwarded-For falsifié ignoré (TRUST_PROXY désactivé) : même IP plateforme → toujours bloquée
const spoof = await handler(new Request('https://nexora.example/contact', { method: 'POST', headers: { origin: 'https://nexora.example', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '198.51.100.7' }, body }), { ip: '203.0.113.30' });
ok('X-Forwarded-For falsifié ignoré', spoof.status === 429, String(spoof.status));

// 5. Fonction planifiée : ménage sans erreur, configuration de planification
const menage = await import(process.cwd() + '/.netlify/test/menage.mjs');
let menageOk = true;
try {
  await menage.default();
} catch {
  menageOk = false;
}
ok('fonction planifiée (ménage)', menageOk && menage.config.schedule === '@hourly');

for (const r of results) console.log(r.join('  '));
process.exit(results.every((r) => r[0] === 'OK ') ? 0 : 1);
