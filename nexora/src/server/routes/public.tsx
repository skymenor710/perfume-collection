import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../context';
import { contactRequests, contentVersion, projectImages, projects } from '../db/schema';
import { displayProject, getContent, getContentVersion, getHomeProjects, getTeamPhoto } from '../lib/repo';
import { areaList, displayContent, rows, type SiteContent } from '../lib/content';
import { checkFormToken, contactSchema, fieldErrors, issueFormToken, looksLikeSpam } from '../lib/contact';
import { hit } from '../lib/rate-limit';
import { notifyRequest } from '../lib/notify';
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

/**
 * En-têtes de cache d'une image de /media. Publiée : cache borné (navigateurs et caches partagés 1 jour, CDN Netlify
 * 1 heure) pour qu'une image retirée de la publication cesse vite d'être servie. Non publiée (admin) : jamais en cache.
 */
function mediaCache(published: boolean): Record<string, string> {
  return published
    ? { 'Cache-Control': 'public, max-age=86400', 'Netlify-CDN-Cache-Control': 'public, max-age=3600' }
    : { 'Cache-Control': 'private, no-store' };
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

  /**
   * Données structurées (schema.org) : prestataire de services avec ses services et sa zone d'intervention. Adresse,
   * e-mail et téléphone n'apparaissent que s'ils sont réellement saisis dans l'admin : rien n'est inventé.
   */
  function organisationJsonLd(content: SiteContent) {
    const url = `${config.publicUrl}/`;
    const services = rows(content.services, 's', 5, ['Title', 'Text'] as const).filter((s) => s.Title);
    const org: Record<string, unknown> = {
      '@type': 'ProfessionalService',
      '@id': `${url}#organisation`,
      name: 'Nexora',
      url,
      logo: `${config.publicUrl}/brand/icon-512.png`,
      image: `${config.publicUrl}/brand/og-image.jpg`,
      description: content.seo.description,
      knowsLanguage: 'fr',
    };
    const areas = areaList(content);
    if (areas.length) org.areaServed = areas.map((name) => ({ '@type': 'Place', name }));
    if (services.length) {
      org.hasOfferCatalog = {
        '@type': 'OfferCatalog',
        name: 'Services',
        itemListElement: services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.Title, description: s.Text } })),
      };
    }
    if (content.legal.address) org.address = content.legal.address;
    if (content.contact.publicEmail) org.email = content.contact.publicEmail;
    if (content.contact.publicPhone) org.telephone = content.contact.publicPhone;
    return {
      '@context': 'https://schema.org',
      '@graph': [org, { '@type': 'WebSite', '@id': `${url}#site`, url, name: 'Nexora', inLanguage: 'fr-FR', publisher: { '@id': `${url}#organisation` } }],
    };
  }

  app.get('/', async (c) => {
    const html = await cached('home', async () => {
      const [stored, home, teamPhoto] = await Promise.all([getContent(db), getHomeProjects(db), getTeamPhoto(db)]);
      const content = displayContent(stored);
      return renderHtml(
        <Document
          meta={{ title: content.seo.title, description: content.seo.description, canonical: `${config.publicUrl}/`, publicUrl: config.publicUrl }}
          assets={assets}
          jsonLd={organisationJsonLd(stored)}
        >
          <HomePage
            content={content}
            results={home.results.map(displayProject)}
            concepts={home.concepts.map(displayProject)}
            teamPhoto={teamPhoto}
            analytics={config.analytics}
          />
        </Document>,
      );
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(html.replace(FORM_TOKEN_PLACEHOLDER, issueFormToken(config.sessionSecret)));
  });

  app.get('/mentions-legales', async (c) => {
    const html = await cached('legal', async () => {
      const content = displayContent(await getContent(db));
      return renderHtml(
        <Document
          meta={{ title: 'Mentions légales — Nexora', description: 'Mentions légales du site Nexora.', canonical: `${config.publicUrl}/mentions-legales`, publicUrl: config.publicUrl }}
          assets={assets}
        >
          <LegalNotice content={content} publicUrl={config.publicUrl} analytics={config.analytics ? 'Plausible Analytics' : null} />
        </Document>,
      );
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(html);
  });

  app.get('/politique-de-confidentialite', async (c) => {
    const html = await cached('privacy', async () => {
      const content = displayContent(await getContent(db));
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
          <PrivacyPolicy content={content} analytics={config.analytics ? 'Plausible Analytics' : null} />
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

    let row: typeof contactRequests.$inferSelect;
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
        .returning();
      row = rows[0];
    } catch (e) {
      deps.log.error({ err: (e as Error).name }, 'contact: enregistrement impossible');
      return fail(500, 'L’enregistrement a échoué. Vos informations sont conservées : réessayez dans un instant.');
    }
    deps.log.info({ requestId: row.id }, 'contact: demande enregistrée');
    await notifyRequest(deps, row);

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
    let row = rows[0];
    // Photo de la section « Derrière Nexora » : publique dès qu'elle est enregistrée.
    if (!row) {
      const team = await getTeamPhoto(db);
      if (team?.id === imageId) row = { variants: team.variants, published: true };
    }
    if (!row) return c.notFound();
    const isAdmin = !!c.get('session');
    if (!row.published && !isAdmin) return c.notFound();
    const variant = row.variants.find((v) => v.width === Number(m[1]) && v.format === m[2]);
    if (!variant) return c.notFound();
    const body = await deps.storage.get(variant.key);
    if (!body) return c.notFound();
    c.header('Content-Type', `image/${variant.format}`);
    for (const [name, value] of Object.entries(mediaCache(row.published))) c.header(name, value);
    c.header('Content-Disposition', 'inline');
    return c.body(new Uint8Array(body));
  });

  app.get('/robots.txt', (c) =>
    c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /contact\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`),
  );
  app.get('/sitemap.xml', async (c) => {
    // Date de dernière modification : celle du contenu publié (textes ou projets), commune aux trois pages.
    const rows = await db.select({ at: contentVersion.updatedAt }).from(contentVersion).limit(1);
    const lastmod = rows[0]?.at ? `<lastmod>${rows[0].at.toISOString().slice(0, 10)}</lastmod>` : '';
    const urls = ['/', '/mentions-legales', '/politique-de-confidentialite'];
    c.header('Content-Type', 'application/xml; charset=utf-8');
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${config.publicUrl}${u}</loc>${lastmod}</url>`)
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
