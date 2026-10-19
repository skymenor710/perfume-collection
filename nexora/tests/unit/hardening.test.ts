// Non-régression des corrections de l'audit de production (19/10/2026).
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ADMIN_PASSWORD, Client, ORIGIN, contactPayload, createAdmin, setup, type TestCtx } from '../helpers';
import { contactRequests } from '../../src/server/db/schema';
import { pgConnectionString } from '../../src/server/db/client';
import { retryNotifications } from '../../src/server/lib/notify';
import { errorSummary } from '../../src/server/log';

let ctx: TestCtx | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const postJson = (c: Client, body: object) =>
  c.req('/contact', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });

describe('connexion : verrouillage sans déni de service', () => {
  it('un appareil déjà connecté échappe au verrouillage provoqué par un tiers', async () => {
    ctx = await setup();
    await createAdmin(ctx);
    const admin = new Client(ctx, '192.0.2.10');
    expect((await admin.login()).status).toBe(303);
    expect(admin.cookies.has('nx_dev')).toBe(true);
    admin.cookies.delete('nx_session');
    for (let i = 0; i < 8; i++) {
      expect((await new Client(ctx, `198.51.100.${i + 1}`).login('admin@nexora.test', `faux-${i}`)).status).toBe(400);
    }
    expect((await new Client(ctx, '192.0.2.11').login()).status).toBe(429);
    expect((await admin.login()).status).toBe(303);
  });

  it('l’empreinte d’appareil ne vaut que pour son compte et tombe au changement de mot de passe', async () => {
    ctx = await setup();
    await createAdmin(ctx);
    await createAdmin(ctx, 'b@nexora.test', 'Autre-Mot-De-Passe-2026');
    const lockOut = async (email: string, prefix: string) => {
      for (let i = 0; i < 8; i++) await new Client(ctx!, `${prefix}.${i + 1}`).login(email, `faux-${i}`);
    };
    const admin = new Client(ctx, '192.0.2.30');
    expect((await admin.login()).status).toBe(303);
    // Le compte B verrouillé par un tiers : l'appareil connu de A ne l'ouvre pas.
    await lockOut('b@nexora.test', '198.51.100');
    admin.cookies.delete('nx_session');
    expect((await admin.login('b@nexora.test', 'Autre-Mot-De-Passe-2026')).status).toBe(429);
    // Changement de mot de passe de A : les appareils connus sont révoqués.
    expect((await admin.login()).status).toBe(303);
    const token = await admin.csrf('/admin/compte');
    const next = 'Nouveau-Mot-De-Passe-2026';
    expect((await admin.form('/admin/compte/mot-de-passe', { _csrf: token, current: ADMIN_PASSWORD, next, confirm: next })).status).toBe(303);
    admin.cookies.delete('nx_session');
    await lockOut('admin@nexora.test', '203.0.113');
    expect((await admin.login('admin@nexora.test', next)).status).toBe(429);
  });

  it('l’appareil connu reste limité par ses propres échecs', async () => {
    ctx = await setup();
    await createAdmin(ctx);
    const admin = new Client(ctx, '192.0.2.20');
    expect((await admin.login()).status).toBe(303);
    admin.cookies.delete('nx_session');
    for (let i = 0; i < 8; i++) expect((await admin.login('admin@nexora.test', `faux-${i}`)).status).toBe(400);
    expect((await admin.login()).status).toBe(429);
  });
});

describe('IP derrière un proxy de confiance', () => {
  it('seule la dernière adresse de X-Forwarded-For compte (la première vient du visiteur)', async () => {
    ctx = await setup();
    for (let i = 0; i < 5; i++) expect((await postJson(new Client(ctx, `10.9.9.${i}, 203.0.113.77`), contactPayload())).status).toBe(201);
    expect((await postJson(new Client(ctx, '10.9.9.200, 203.0.113.77'), contactPayload())).status).toBe(429);
    expect((await postJson(new Client(ctx, '10.9.9.200, 203.0.113.78'), contactPayload())).status).toBe(201);
  });
});

describe('notifications e-mail', () => {
  it('une notification en échec est renvoyée par la tâche horaire', async () => {
    ctx = await setup({ mail: 'fail' });
    expect((await postJson(new Client(ctx), contactPayload())).status).toBe(201);
    let [row] = await ctx.deps.db.select().from(contactRequests);
    expect(row.notifiedAt).toBeNull();
    expect(row.notifyError).toContain('HTTP 500');
    // Le fournisseur répond de nouveau.
    const sent = ctx.sent;
    ctx.deps.mailer = { configured: true, send: async (m) => void sent.push(m) };
    expect(await retryNotifications(ctx.deps)).toBe(1);
    [row] = await ctx.deps.db.select().from(contactRequests).where(eq(contactRequests.id, row.id));
    expect(row.notifiedAt).not.toBeNull();
    expect(row.notifyError).toBeNull();
    expect(ctx.sent[0].text).toContain(`${ORIGIN}/admin/demandes/${row.id}`);
    // Rien à renvoyer ensuite.
    expect(await retryNotifications(ctx.deps)).toBe(0);
  });

  it('deux passages simultanés n’envoient qu’une fois la même notification', async () => {
    ctx = await setup({ mail: 'fail' });
    expect((await postJson(new Client(ctx), contactPayload())).status).toBe(201);
    let calls = 0;
    ctx.deps.mailer = { configured: true, send: async () => void (calls++, await new Promise((r) => setTimeout(r, 30))) };
    const [a, b] = await Promise.all([retryNotifications(ctx.deps), retryNotifications(ctx.deps)]);
    expect(a + b).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('journal des erreurs', () => {
  it('une requête SQL échouée est journalisée sans ses paramètres', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "admins_email_unique"'), { code: '23505' });
    const err = new Error('Failed query: insert into "admins" ("email", "password_hash") values ($1, $2)\nparams: alice@example.fr,$scrypt$secret', { cause });
    const s = errorSummary(err);
    expect(JSON.stringify(s)).not.toContain('alice@example.fr');
    expect(JSON.stringify(s)).not.toContain('$scrypt$secret');
    expect(s.message).toContain('Failed query: insert into "admins"');
    expect(s.code).toBe('23505');
    expect(s.cause).toContain('admins_email_unique');
  });

  it('les paramètres sont masqués aussi dans la cause et dans une pile au format inattendu', () => {
    const inner = new Error('Failed query: select 1\nparams: bob@example.fr');
    const err = new Error('échec du traitement', { cause: inner });
    err.stack = 'Error: autre texte\nparams: carol@example.fr\n    at f (x.ts:1:1)';
    const s = JSON.stringify(errorSummary(err));
    expect(s).not.toContain('bob@example.fr');
    expect(s).not.toContain('carol@example.fr');
    expect(s).toContain('at f (x.ts:1:1)');
  });
});

describe('connexion PostgreSQL', () => {
  it('TLS vérifié par défaut pour un hôte distant ; local et choix explicite inchangés', () => {
    expect(pgConnectionString('postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db')).toContain('sslmode=verify-full');
    expect(pgConnectionString('postgres://u:p@ep-x.neon.tech/db?sslmode=require')).toContain('sslmode=verify-full');
    expect(pgConnectionString('postgres://u:p@127.0.0.1:5433/db')).not.toContain('sslmode');
    expect(pgConnectionString('postgres://u:p@db:5432/x')).not.toContain('sslmode');
    expect(pgConnectionString('postgres://u:p@h.example.org/x?sslmode=disable')).toContain('sslmode=disable');
    expect(pgConnectionString('postgres://u:p@10.0.0.5/x')).not.toContain('sslmode');
    expect(pgConnectionString('postgres://u:p@192.168.1.20/x')).not.toContain('sslmode');
    expect(pgConnectionString('postgres://u:p@db.internal/x')).not.toContain('sslmode');
  });
});
