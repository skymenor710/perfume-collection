import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../context';
import { contactRequests, projectImages, projects } from '../db/schema';
import { getContent, getContentVersion, getHomeProjects } from '../lib/repo';
import { checkFormToken, contactSchema, fieldErrors, issueFormToken, looksLikeSpam } from '../lib/contact';
import { hit } from '../lib/rate-limit';
import { fingerprint, } from '../lib/security';
import { sameOrigin } from '../lib/auth';
import { Document } from '../views/layout';
import { FORM_TOKEN_PLACEHOLDER, HomePage } from '../views/site/home';
import { LegalNotice, PrivacyPolicy } from '../views/site/legal';
import { ErrorPage } from '../views/site/error';
import { renderHtml } from '../views/render';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Cache de la page d'accueil : HTML rendu une fois par version de contenu. Chaque requête lit seulement le numéro de
 * version (une requête SQL minuscule) : une modification dans l'admin — sur n'importe quelle instance — incrémente la
 * version et la page suivante est re-rendue. Aucune intervention manuelle, aucun délai.
 */
export class PageCache {
  private entries = new Map<string, { version: number; html: string }>();
  get(key: string, version: number) {
    const e = this.entries.get(key);
    return e && e.version === version ? e.html : null;
  }
  set(key: string, version: number, html: string) {
    this.entries.set(key, { version, html });
  }
  clear() {
    this.entries.clear();
  }
}

export function publicRoutes(deps: Deps, cache: PageCache) {
  const app = new Hono<AppEnv>();
  const { db, config, assets } = deps;

  async function cached(key: string, render: () => Promise<string>) {
    const version = await getContentVersion(db);
    let html = cache.get(key, version);
    if (!html) {
      html = await render();
      cache.set(key, version, html);
    }
    return html;
  }

  app.get('/', async (c) => {
    const html = await cached('home', async () => {
      const [content, list] = await Promise.all([getContent(db), getHomeProjects(db)]);
      return renderHtml(
        <Document
          meta={{ title: content.seo.title, description: content.seo.description, canonical: `${config.publicUrl}/`, publicUrl: config.publicUrl }}
          assets={assets}
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Nexora',
            url: `${config.publicUrl}/`,
            logo: `${config.publicUrl}/brand/icon-512.png`,
            description: content.seo.description,
          }}
        >
          <HomePage content={content} projects={list} showPlaceholders={config.showPlaceholders} />
        </Document>,
      );
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(html.replace(FORM_TOKEN_PLACEHOLDER, issueFormToken(config.sessionSecret)));
  });

  app.get('/mentions-legales', async (c) => {
    const html = await cached('legal', async () => {
      const content = await getContent(db);
      return renderHtml(
        <Document
          meta={{ title: 'Mentions légales — Nexora', description: 'Mentions légales du site Nexora.', canonical: `${config.publicUrl}/mentions-legales`, publicUrl: config.publicUrl }}
          assets={assets}
        >
          <LegalNotice content={content} publicUrl={config.publicUrl} />
        </Document>,
      );
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(html);
  });

  app.get('/politique-de-confidentialite', async (c) => {
    const html = await cached('privacy', async () => {
      const content = await getContent(db);
      return renderHtml(
        <Document
          meta={{
            title: 'Politique de confidentialité — Nexora',
            description: 'Comment Nexora traite les informations envoyées via le formulaire de contact.',
            canonical: `${config.publicUrl}/politique-de-confidentialite`,
            publicUrl: config.publicUrl,
          }}
          assets={assets}
        >
          <PrivacyPolicy content={content} />
        </Document>,
      );
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(html);
  });

  /** Formulaire de contact : JSON (fetch) ou formulaire classique (sans JavaScript). */
  app.post('/contact', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ message: 'Message trop long.' }, 413) }), async (c) => {
    const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
    const fail = (status: 400 | 403 | 422 | 429 | 500, message: string, errors?: Record<string, string>) => {
      if (wantsJson) return c.json({ message, ...(errors ? { errors } : {}) }, status);
      return c.html(
        renderHtml(
          <Document meta={{ title: 'Envoi impossible — Nexora', description: message, canonical: `${config.publicUrl}/`, publicUrl: config.publicUrl, noindex: true }} assets={assets}>
            <ErrorPage title="Votre demande n’a pas pu être envoyée" message={errors ? Object.values(errors).join(' ') : message} back="/#contact" backLabel="Revenir au formulaire" />
          </Document>,
        ),
        status,
      );
    };

    if (!sameOrigin(c, config.publicOrigin)) return fail(403, 'Origine de la requête refusée.');

    const rl = await hit(db, fingerprint(deps, 'contact-ip', c.get('clientIp')), 5, 15 * 60);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return fail(429, `Trop de demandes envoyées. Réessayez dans ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`);
    }

    let raw: Record<string, unknown>;
    try {
      const ct = c.req.header('content-type') ?? '';
      raw = ct.includes('application/json') ? await c.req.json() : await c.req.parseBody();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad body');
    } catch {
      return fail(400, 'Requête invalide.');
    }

    // Pot de miel rempli ou jeton absent/falsifié/trop rapide : réponse neutre, rien n'est enregistré.
    const token = checkFormToken(config.sessionSecret, raw.token);
    if ((typeof raw.website === 'string' && raw.website.trim() !== '') || token !== 'ok') {
      deps.log.info({ reason: raw.website ? 'honeypot' : `token-${token}` }, 'contact: envoi rejeté (anti-spam)');
      if (token === 'too-fast') return fail(422, 'Envoi trop rapide. Patientez quelques secondes puis réessayez.');
      return fail(400, 'Le formulaire a expiré. Rechargez la page puis réessayez.');
    }

    const parsed = contactSchema.safeParse(raw);
    if (!parsed.success) return fail(422, 'Certains champs sont à corriger.', fieldErrors(parsed.error));
    const input = parsed.data;
    if (looksLikeSpam(input)) return fail(422, 'Votre message contient trop de liens.', { message: 'Votre message contient trop de liens (3 maximum).' });

    let id: string;
    try {
      const rows = await db
        .insert(contactRequests)
        .values({
          name: input.name,
          company: input.company || null,
          email: input.email,
          phone: input.phone || null,
          projectType: input.projectType,
          budget: input.budget || null,
          timeline: input.timeline || null,
          message: input.message,
          privacyAckAt: new Date(),
        })
        .returning({ id: contactRequests.id });
      id = rows[0].id;
    } catch (e) {
      deps.log.error({ err: (e as Error).name }, 'contact: enregistrement impossible');
      return fail(500, 'L’enregistrement a échoué. Vos informations sont conservées : réessayez dans un instant.');
    }
    deps.log.info({ requestId: id }, 'contact: demande enregistrée');

    // Notification e-mail APRÈS l'enregistrement : un échec d'envoi n'annule jamais la demande.
    if (deps.mailer.configured) {
      try {
        await deps.mailer.send({
          subject: `Nouvelle demande de contact — ${input.projectType}`,
          replyTo: input.email,
          text: [
            'Nouvelle demande reçue sur le site Nexora.',
            '',
            `Nom : ${input.name}`,
            `Entreprise : ${input.company || '—'}`,
            `E-mail : ${input.email}`,
            `Téléphone : ${input.phone || '—'}`,
            `Type de projet : ${input.projectType}`,
            `Budget estimatif : ${input.budget || '—'}`,
            `Délai souhaité : ${input.timeline || '—'}`,
            '',
            input.message,
            '',
            `Consulter dans l'administration : ${config.publicUrl}/admin/demandes/${id}`,
          ].join('\n'),
        });
        await db.update(contactRequests).set({ notifiedAt: new Date() }).where(eq(contactRequests.id, id));
      } catch (e) {
        const msg = (e as Error).message.slice(0, 200);
        deps.log.warn({ requestId: id, error: msg }, 'contact: notification e-mail non envoyée');
        await db.update(contactRequests).set({ notifyError: msg }).where(eq(contactRequests.id, id));
      }
    } else {
      await db.update(contactRequests).set({ notifyError: 'Notification e-mail non configurée' }).where(eq(contactRequests.id, id));
    }

    const content = await getContent(db);
    if (wantsJson) return c.json({ message: content.contact.successMessage }, 201);
    return c.redirect('/?envoi=ok#contact', 303);
  });

  /**
   * Images des projets. Une image n'est servie que si son projet est publié, ou à un administrateur connecté
   * (aperçu dans l'admin). Les noms de fichiers sont fixés par le serveur : aucun chemin arbitraire.
   */
  app.get('/media/:imageId/:file', async (c) => {
    const { imageId, file } = c.req.param();
    const m = /^(\d{2,4})\.(avif|webp)$/.exec(file);
    if (!UUID_RE.test(imageId) || !m) return c.notFound();
    const rows = await db
      .select({ variants: projectImages.variants, published: projects.published })
      .from(projectImages)
      .innerJoin(projects, eq(projects.id, projectImages.projectId))
      .where(eq(projectImages.id, imageId))
      .limit(1);
    const row = rows[0];
    if (!row) return c.notFound();
    const isAdmin = !!c.get('session');
    if (!row.published && !isAdmin) return c.notFound();
    const variant = row.variants.find((v) => v.width === Number(m[1]) && v.format === m[2]);
    if (!variant) return c.notFound();
    const body = await deps.storage.get(variant.key);
    if (!body) return c.notFound();
    c.header('Content-Type', `image/${variant.format}`);
    c.header('Cache-Control', row.published ? 'public, max-age=31536000, immutable' : 'private, no-store');
    c.header('Content-Disposition', 'inline');
    return c.body(new Uint8Array(body));
  });

  app.get('/robots.txt', (c) =>
    c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /contact\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`),
  );
  app.get('/sitemap.xml', (c) => {
    const urls = ['/', '/mentions-legales', '/politique-de-confidentialite'];
    c.header('Content-Type', 'application/xml; charset=utf-8');
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${config.publicUrl}${u}</loc></url>`)
        .join('\n')}\n</urlset>\n`,
    );
  });
  app.get('/site.webmanifest', (c) => {
    c.header('Content-Type', 'application/manifest+json');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(
      JSON.stringify({
        name: 'Nexora',
        short_name: 'Nexora',
        start_url: '/',
        display: 'browser',
        background_color: '#09090C',
        theme_color: '#09090C',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      }),
    );
  });
  app.get('/healthz', async (c) => {
    try {
      await getContentVersion(db);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  return app;
}
