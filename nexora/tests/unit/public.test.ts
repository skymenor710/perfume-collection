import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { count, eq } from 'drizzle-orm';
import { Client, contactPayload, setup, type TestCtx } from '../helpers';
import { contactRequests, projects } from '../../src/server/db/schema';
import { seedDemo } from '../../src/server/db/seed';
import { issueFormToken } from '../../src/server/lib/contact';
import { loadConfig } from '../../src/server/config';
import { bumpContentVersion, saveContent } from '../../src/server/lib/repo';
import { defaultContent } from '../../src/server/lib/content';

const SEED_DIR = path.resolve('seed/demo');
let ctx: TestCtx;

describe('site public', () => {
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => ctx.close());

  it('page d’acquisition : promesse, services, méthode, 3 études de cas (concepts signalés), FAQ, formulaire visible', async () => {
    await seedDemo(ctx.deps, SEED_DIR);
    const res = await new Client(ctx).req('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    // Hero orienté résultat, deux appels à l'action et réassurance.
    expect(html).toContain('Des sites web pensés pour');
    expect(html).toContain('générer des demandes,');
    expect(html).toContain('pas seulement des compliments.');
    expect(html).toContain('Réserver un diagnostic de 20 min');
    expect(html).toContain('Voir des résultats clients');
    expect(html).toContain('Sans engagement · Réponse sous 1 jour ouvré');
    // Sections dans l'ordre demandé, et navigation correspondante.
    const order = ['id="accueil"', 'class="proof"', 'id="services"', 'id="methode"', 'id="realisations"', 'id="temoignages"', 'id="faq"', 'id="contact"'].map((m) => html.indexOf(m));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    for (const href of ['/#services', '/#methode', '/#realisations', '/#faq', '/#contact']) expect(html).toContain(`href="${href}"`);
    // Une seule balise h1 ; les sections ont un titre h2.
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    for (const t of ['Sites vitrines', 'Refonte de site', 'E-commerce', 'Automatisations et outils digitaux']) expect(html).toContain(t);
    for (const t of ['Diagnostic et stratégie', 'Design et développement', 'Lancement et optimisation']) expect(html).toContain(t);
    for (const t of ['délai', 'budget', 'maintenance', 'Google', 'appartient', 'collaboration']) expect(html.toLowerCase()).toContain(t.toLowerCase());
    // Études de cas : contexte, solution, résultats ; concepts clairement identifiés, aucun résultat inventé.
    expect(html.match(/class="case[ "]/g)?.length).toBe(3);
    expect(html.match(/Concept \/ Démonstration/g)?.length).toBe(3);
    expect(html.match(/<dt>Contexte \/ défi<\/dt>/g)?.length).toBe(3);
    expect(html.match(/<dt>Solution apportée<\/dt>/g)?.length).toBe(3);
    expect(html.match(/aucun résultat mesuré à ce jour/g)?.length).toBe(3);
    expect(html).not.toContain('badge-client');
    // Captures : 4 vignettes par cas, chacune ouvre la visionneuse avec ses sources HD (jusqu'à 2400 px).
    expect(html.match(/class="case__thumb"/g)?.length).toBe(12);
    expect(html.match(/data-shot="true"/g)?.length).toBe(12);
    expect(html).toMatch(/data-webp="[^"]*\/2400\.webp 2400w"/);
    expect(html.match(/<dialog class="lightbox"/g)?.length).toBe(1);
    expect(html.match(/data-gallery="/g)?.length).toBe(3);
    const imgs = [...html.matchAll(/<img src="\/media\/[^>]+>/g)].map((m) => m[0]);
    expect(imgs.length).toBe(15);
    for (const img of imgs) {
      expect(img).toMatch(/width="\d+"/);
      expect(img).toContain('loading="lazy"');
    }
    // Textes alternatifs : portés par les boutons (nom accessible) et repris en légende dans la visionneuse.
    expect(html.match(/aria-label="Agrandir l’image \d sur 4 : Site /g)?.length).toBe(15);
    // Formulaire visible d'emblée (pas de bouton pour le révéler), champs de qualification facultatifs.
    expect(html).not.toContain('data-contact-toggle');
    expect(html).toContain('id="cf-budget"');
    expect(html).toContain('id="cf-timeline"');
    expect(html).toContain('Nous vous répondons sous 1 jour ouvré.');
    expect(html).toContain('href="/politique-de-confidentialite"');
    expect(html).toContain('href="/mentions-legales"');
    // Hors production : emplacements « à compléter » visibles pour la preuve sociale et les témoignages, sans données inventées.
    expect(html).toContain('data-placeholder="proof"');
    expect(html).toContain('data-placeholder="testimonials"');
    // Symbole N 4K et logotype vectoriel.
    expect(html).toContain('/brand/symbol-1600.avif 1600w');
    expect(html).toContain('/brand/wordmark.svg');
    // Identité des prospects jamais affichée ; jeton du formulaire remplacé à chaque requête.
    expect(html).not.toMatch(/AWM/i);
    expect(html).not.toContain('__NX_FORM_TOKEN__');
  }, 180_000);

  it('preuve sociale et témoignages : jamais de remplissage en production, affichés dès qu’ils sont renseignés', async () => {
    await ctx.close();
    ctx = await setup({ env: { SHOW_PLACEHOLDERS: 'false' } });
    let html = await (await new Client(ctx).req('/')).text();
    expect(html).not.toContain('class="proof"');
    expect(html).not.toContain('id="temoignages"');
    expect(html).not.toContain('data-placeholder');
    const content = structuredClone(defaultContent);
    content.proof.item1Value = '4,9/5';
    content.proof.item1Label = 'note moyenne sur Google (12 avis)';
    content.testimonials.t1Quote = 'Citation réelle.';
    content.testimonials.t1Author = 'Prénom Nom';
    content.contact.bookingUrl = 'https://cal.com/nexora/diagnostic';
    content.contact.whatsappNumber = '+33 6 12 34 56 78';
    await saveContent(ctx.deps.db, content);
    await bumpContentVersion(ctx.deps.db);
    html = await (await new Client(ctx).req('/')).text();
    expect(html).toContain('4,9/5');
    expect(html).toContain('Citation réelle.');
    expect(html).not.toContain('data-placeholder');
    // Lien de rendez-vous : utilisé par les boutons « Réserver » (nouvel onglet) ; WhatsApp : lien wa.me.
    expect(html).toContain('href="https://cal.com/nexora/diagnostic" target="_blank" rel="noopener"');
    expect(html).toContain('href="https://wa.me/33612345678?text=');
  });

  it('gère 0 projet et les projets sans image', async () => {
    let html = await (await new Client(ctx).req('/')).text();
    expect(html).toContain('Nos premières études de cas seront bientôt présentées ici.');
    await ctx.deps.db.insert(projects).values({ name: 'Projet vide', published: true, sortOrder: 1 });
    await bumpContentVersion(ctx.deps.db);
    html = await (await new Client(ctx).req('/')).text();
    expect(html).toContain('Projet vide');
    expect(html).toContain('Visuel à venir');
    expect(html).not.toContain('<dialog class="lightbox"');
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

  it('fichiers de marque reconstruits présents (symbole 4K décliné, masque vectoriel, logotype)', async () => {
    const dir = path.resolve('public/brand');
    for (const w of [96, 192, 320, 480, 640, 960, 1280, 1600]) {
      for (const ext of ['avif', 'webp']) {
        const meta = await sharp(path.join(dir, `symbol-${w}.${ext}`)).metadata();
        expect(meta.width, `symbol-${w}.${ext}`).toBe(w);
        expect(meta.hasAlpha, `symbol-${w}.${ext}`).toBe(true);
      }
    }
    for (const svg of ['symbol-wine.svg', 'wordmark.svg']) {
      const text = readFileSync(path.join(dir, svg), 'utf8');
      expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+"/);
      expect(text).not.toMatch(/<script|on\w+=/i);
    }
    // Logotype : grille de dessin alignée sur les pixels (affiché à 133 × 22 px = 1 unité par pixel).
    expect(readFileSync(path.join(dir, 'wordmark.svg'), 'utf8')).toContain('viewBox="-1 -1 133 22" width="133" height="22"');
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
    expect(rows[0]).toMatchObject({ name: 'Camille Martin', email: 'camille@example.fr', status: 'new', projectType: 'Site vitrine', budget: null, timeline: null });
    // E-mail non configuré : pas d'envoi simulé, l'absence est consignée.
    expect(rows[0].notifiedAt).toBeNull();
    expect(rows[0].notifyError).toBe('Notification e-mail non configurée');
  });

  it('enregistre le budget estimatif et le délai souhaité (facultatifs, listes fermées)', async () => {
    ctx = await setup();
    const ok = await postJson(new Client(ctx), contactPayload({ budget: '3 000 à 6 000 €', timeline: 'Dans 1 à 3 mois' }));
    expect(ok.status).toBe(201);
    const [row] = await ctx.deps.db.select().from(contactRequests);
    expect(row).toMatchObject({ budget: '3 000 à 6 000 €', timeline: 'Dans 1 à 3 mois' });
    const bad = await postJson(new Client(ctx, '203.0.113.50'), contactPayload({ budget: '1 million', timeline: 'hier' }));
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['budget', 'timeline']);
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
