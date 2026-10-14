import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { Client, contactPayload, setup, type TestCtx } from '../helpers';
import { contactRequests, projects } from '../../src/server/db/schema';
import { seedDemo } from '../../src/server/db/seed';
import { issueFormToken } from '../../src/server/lib/contact';
import { loadConfig } from '../../src/server/config';
import { bumpContentVersion } from '../../src/server/lib/repo';

const SEED_DIR = path.resolve('seed/demo');
let ctx: TestCtx;

describe('site public', () => {
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => ctx.close());

  it('affiche les 3 projets de démonstration, chacun avec son propre carrousel', async () => {
    await seedDemo(ctx.deps, SEED_DIR);
    const res = await new Client(ctx).req('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Des sites qui donnent une');
    expect(html).toContain('nouvelle dimension');
    expect(html).toContain('Des projets concrets.');
    expect(html).toContain('Votre prochain site');
    expect(html).toContain('Aperçus de démonstration');
    expect(html.match(/data-carousel=""/g)?.length).toBe(3);
    for (const n of [1, 2, 3]) expect(html).toContain(`id="carousel-${n}"`);
    expect(html.match(/class="carousel__slide"/g)?.length).toBe(12);
    expect(html.match(/class="badge-demo"/g)?.length).toBe(3);
    // 1re image de chaque carrousel : chargement paresseux ; les suivantes : différées (data-src, chargées à l'usage).
    // Toutes ont des dimensions (pas de décalage) et un texte alternatif.
    expect(html.match(/<picture>/g)?.length).toBe(3);
    expect(html.match(/<picture data-deferred/g)?.length).toBe(9);
    const deferred = [...html.matchAll(/<img data-src="\/media\/[^>]+>/g)].map((m) => m[0]);
    expect(deferred.length).toBe(9);
    const imgs = [...html.matchAll(/<img (?:data-)?src="\/media\/[^>]+>/g)].map((m) => m[0]);
    for (const img of imgs) {
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/alt="Site d/);
    }
    expect(html).toContain('href="https://www.snohetta.com"');
    expect(html).toContain('Opinel');
    expect(html).toContain('Wavestone');
    // Jeton du formulaire remplacé à chaque requête.
    expect(html).not.toContain('__NX_FORM_TOKEN__');
  }, 180_000);

  it('gère 0 projet et les projets sans image', async () => {
    let html = await (await new Client(ctx).req('/')).text();
    expect(html).toContain('Nos premières réalisations seront bientôt présentées ici.');
    await ctx.deps.db.insert(projects).values({ name: 'Projet vide', published: true, sortOrder: 1 });
    await bumpContentVersion(ctx.deps.db);
    html = await (await new Client(ctx).req('/')).text();
    expect(html).toContain('Projet vide');
    expect(html).toContain('Visuel à venir');
    expect(html).not.toContain('data-carousel-prev');
  });

  it('envoie les en-têtes de sécurité avec une CSP sans inline', async () => {
    const res = await new Client(ctx).req('/');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    const admin = await new Client(ctx).req('/admin/connexion');
    expect(admin.headers.get('x-robots-tag')).toContain('noindex');
    expect(admin.headers.get('cache-control')).toBe('no-store');
  });

  it('pages légales : champs non remplis signalés « À compléter », jamais inventés', async () => {
    const html = await (await new Client(ctx).req('/mentions-legales')).text();
    expect(html).toContain('Mentions légales');
    expect(html).toContain('À compléter');
    const pp = await (await new Client(ctx).req('/politique-de-confidentialite')).text();
    expect(pp).toContain('Vos droits');
    expect(pp).toContain('cnil.fr');
  });

  it('404 neutre, robots.txt et sitemap', async () => {
    const c = new Client(ctx);
    const nf = await c.req('/nexiste-pas');
    expect(nf.status).toBe(404);
    expect(await nf.text()).toContain('Page introuvable');
    expect(await (await c.req('/robots.txt')).text()).toContain('Disallow: /admin');
    expect(await (await c.req('/sitemap.xml')).text()).toContain('<loc>http://localhost/</loc>');
  });
});

describe('formulaire de contact', () => {
  afterEach(async () => ctx.close());

  async function stored() {
    return Number((await ctx.deps.db.select({ n: count() }).from(contactRequests))[0].n);
  }
  const postJson = (c: Client, body: unknown, extra: { origin?: string | null } = {}) =>
    c.req('/contact', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), ...extra });

  it('enregistre une demande valide et répond 201 seulement après stockage', async () => {
    ctx = await setup();
    const res = await postJson(new Client(ctx), contactPayload());
    expect(res.status).toBe(201);
    expect((await res.json()).message).toContain('bien été enregistrée');
    const rows = await ctx.deps.db.select().from(contactRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Camille Martin', email: 'camille@example.fr', status: 'new', projectType: 'Site vitrine' });
    // E-mail non configuré : pas d'envoi simulé, l'absence est consignée.
    expect(rows[0].notifiedAt).toBeNull();
    expect(rows[0].notifyError).toBe('Notification e-mail non configurée');
  });

  it('formulaire classique (sans JavaScript) : redirection 303 vers la confirmation', async () => {
    ctx = await setup();
    const res = await new Client(ctx).form('/contact', contactPayload());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?envoi=ok#contact');
    expect(await stored()).toBe(1);
  });

  it('refuse les données invalides avec un message par champ, sans rien enregistrer', async () => {
    ctx = await setup();
    const res = await postJson(new Client(ctx), contactPayload({ name: '', email: 'pas-un-email', projectType: 'Inconnu', message: 'court', phone: 'abc' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Object.keys(body.errors).sort()).toEqual(['email', 'message', 'name', 'phone', 'projectType']);
    expect(await stored()).toBe(0);
  });

  it('anti-spam : pot de miel, jeton absent/falsifié, envoi trop rapide, trop de liens', async () => {
    ctx = await setup();
    const c = new Client(ctx);
    expect((await postJson(c, contactPayload({ website: 'http://spam.example' }))).status).toBe(400);
    expect((await postJson(c, contactPayload({ token: '' }))).status).toBe(400);
    expect((await postJson(c, contactPayload({ token: '1700000000000.forged-signature-xxxx' }))).status).toBe(400);
    const fast = await postJson(new Client(ctx, '203.0.113.99'), contactPayload({ token: issueFormToken(ctx.deps.config.sessionSecret, Date.now()) }));
    expect(fast.status).toBe(422);
    const links = await postJson(new Client(ctx, '203.0.113.98'), contactPayload({ message: 'http://a.fr http://b.fr http://c.fr http://d.fr achetez' }));
    expect(links.status).toBe(422);
    expect(await stored()).toBe(0);
  });

  it('refuse une origine étrangère', async () => {
    ctx = await setup();
    const res = await postJson(new Client(ctx), contactPayload(), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await stored()).toBe(0);
  });

  it('limite le débit : 5 envois / 15 min / IP', async () => {
    ctx = await setup();
    const c = new Client(ctx, '198.51.100.7');
    for (let i = 0; i < 5; i++) expect((await postJson(c, contactPayload())).status).toBe(201);
    const blocked = await postJson(c, contactPayload());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    // Une autre IP n'est pas affectée.
    expect((await postJson(new Client(ctx, '198.51.100.8'), contactPayload())).status).toBe(201);
  });

  it('refuse un corps trop volumineux', async () => {
    ctx = await setup();
    const res = await postJson(new Client(ctx), contactPayload({ message: 'x'.repeat(40_000) }));
    expect(res.status).toBe(413);
  });

  it('notifie par e-mail quand le fournisseur est configuré ; un échec n’annule pas la demande', async () => {
    ctx = await setup({ mail: 'ok' });
    expect((await postJson(new Client(ctx), contactPayload())).status).toBe(201);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].subject).toContain('Site vitrine');
    const [row] = await ctx.deps.db.select().from(contactRequests);
    expect(row.notifiedAt).not.toBeNull();
    await ctx.close();

    ctx = await setup({ mail: 'fail' });
    const res = await postJson(new Client(ctx), contactPayload());
    expect(res.status).toBe(201);
    const [failed] = await ctx.deps.db.select().from(contactRequests);
    expect(failed.notifiedAt).toBeNull();
    expect(failed.notifyError).toContain('HTTP 500');
  });

  it('stocke le texte tel quel (requêtes paramétrées) — aucune injection SQL', async () => {
    ctx = await setup();
    const evil = "Robert'); DROP TABLE contact_requests;--";
    expect((await postJson(new Client(ctx), contactPayload({ name: evil }))).status).toBe(201);
    const rows = await ctx.deps.db.select().from(contactRequests).where(eq(contactRequests.name, evil));
    expect(rows).toHaveLength(1);
  });
});

describe('configuration', () => {
  it('exige SESSION_SECRET en production et un stockage S3 complet', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://nexora.fr' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'development', STORAGE_DRIVER: 's3', S3_BUCKET: 'x' })).toThrow(/S3/);
    const c = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://nexora.fr', SESSION_SECRET: 'x'.repeat(40) });
    expect(c.cookieSecure).toBe(true);
    expect(c.mail.configured).toBe(false);
    expect(c.mail.missing).toEqual(['MAIL_PROVIDER']);
  });
});
