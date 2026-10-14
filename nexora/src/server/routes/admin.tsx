import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, asc, count, desc, eq, gt, lt, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv, Deps } from '../context';
import { admins, contactRequests, projectImages, projects } from '../db/schema';
import { createSession, destroyOtherSessions, destroySession, loadSession, preCookieName, requireAdmin, requireCsrf, sameOrigin } from '../lib/auth';
import { PASSWORD_MAX, PASSWORD_MIN, dummyHash, hashPassword, randomToken, safeEqual, verifyPassword } from '../lib/crypto';
import { hit, peek, reset } from '../lib/rate-limit';
import { fingerprint } from '../lib/security';
import { audit, bumpContentVersion, getContent, getProject, listProjects, saveContent, getTeamPhoto, setTeamPhoto } from '../lib/repo';
import { contentSchema, missingLegal, type SiteContent, rows } from '../lib/content';
import { ImageRejected, processAndStoreImage } from '../lib/images';
import { renderHtml } from '../views/render';
import type { Flash } from '../views/admin/layout';
import {
  AccountPage,
  AdminErrorPage,
  ContentPage,
  DashboardPage,
  LoginPage,
  ProjectEditPage,
  ProjectsPage,
  RequestDetailPage,
  RequestsPage,
  type ProjectFormValues,
  type Warning,
} from '../views/admin/pages';
import type { PageCache } from './public';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOGIN_IP_LIMIT = 20; // tentatives / 15 min / IP
const LOGIN_ACCOUNT_LIMIT = 8; // échecs / 15 min / compte
const LOGIN_WINDOW = 15 * 60;
const MAX_FILES = 10;

/* ---------- Messages flash (cookie court, seulement des textes produits par le serveur) ---------- */
function setFlash(c: Context, flash: Flash) {
  const lines = flash.lines.map((l) => l.slice(0, 300)).slice(0, 12);
  setCookie(c, 'nx_flash', Buffer.from(JSON.stringify({ ...flash, lines })).toString('base64url'), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60,
  });
}
function takeFlash(c: Context): Flash | null {
  const v = getCookie(c, 'nx_flash');
  if (!v) return null;
  deleteCookie(c, 'nx_flash', { path: '/admin' });
  try {
    const f = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as Flash;
    if (!['ok', 'error', 'info'].includes(f.type) || !Array.isArray(f.lines)) return null;
    return { type: f.type, lines: f.lines.filter((l) => typeof l === 'string').slice(0, 12) };
  } catch {
    return null;
  }
}


const httpUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(300, '300 caractères maximum.')
    .refine((v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !!u.hostname.includes('.');
      } catch {
        return false;
      }
    }, `${label} invalide : elle doit commencer par https:// (ou http://).`);

const projectFormSchema = z.object({
  name: z.string().trim().min(1, 'Indiquez un nom.').max(120, '120 caractères maximum.'),
  category: z.string().trim().max(120, '120 caractères maximum.'),
  description: z.string().trim().max(400, '400 caractères maximum.'),
  url: httpUrl('Adresse'),
  challenge: z.string().trim().max(500, '500 caractères maximum.'),
  solution: z.string().trim().max(500, '500 caractères maximum.'),
  principles: z.string().trim().max(600, '600 caractères maximum.'),
  results: z.string().trim().max(500, '500 caractères maximum.'),
  testimonialQuote: z.string().trim().max(500, '500 caractères maximum.'),
  testimonialAuthor: z.string().trim().max(120, '120 caractères maximum.'),
  caseUrl: httpUrl('Adresse de l’étude de cas'),
  featuredPosition: z.enum(['', '1', '2', '3']),
  published: z.boolean(),
  isDemo: z.boolean(),
});

function safeNext(next: unknown) {
  if (typeof next !== 'string') return '/admin';
  return /^\/admin(\/[a-zA-Z0-9/_-]*)?$/.test(next) ? next : '/admin';
}

export function adminRoutes(deps: Deps, cache: PageCache) {
  const { db, config, assets } = deps;
  const app = new Hono<AppEnv>();

  app.use('*', loadSession(deps));
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  /** Après toute modification visible publiquement : nouvelle version de contenu (toutes instances) + cache local vidé. */
  async function published() {
    await bumpContentVersion(db);
    cache.clear();
  }
  async function newCount() {
    const r = await db.select({ n: count() }).from(contactRequests).where(eq(contactRequests.status, 'new'));
    return Number(r[0]?.n ?? 0);
  }
  const html = (c: Context, node: Parameters<typeof renderHtml>[0], status: 200 | 400 | 404 | 422 | 429 = 200) => c.html(renderHtml(node), status);

  /* ------------------------------------------------------------ Connexion */
  app.get('/connexion', async (c) => {
    if (c.get('session')) return c.redirect('/admin', 303);
    let pre = getCookie(c, preCookieName(config.cookieSecure));
    if (!pre || pre.length > 64) {
      pre = randomToken(24);
      setCookie(c, preCookieName(config.cookieSecure), pre, { httpOnly: true, secure: config.cookieSecure, sameSite: 'Strict', path: '/', maxAge: 3600 });
    }
    return html(c, <LoginPage assets={assets} preToken={pre} next={safeNext(c.req.query('next'))} />);
  });

  app.post('/connexion', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    const body = await c.req.parseBody();
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 160);
    const password = String(body.password ?? '');
    const next = safeNext(body.next);
    const pre = getCookie(c, preCookieName(config.cookieSecure)) ?? '';
    const renderError = (message: string, status: 400 | 429 = 400) =>
      html(c, <LoginPage assets={assets} preToken={pre || randomToken(24)} error={message} email={email} next={next} />, status);

    // Anti-CSRF de connexion : même origine + jeton pré-session (double soumission).
    if (!sameOrigin(c, config.publicOrigin) || !pre || !safeEqual(String(body._pre ?? ''), pre)) {
      return renderError('Session de connexion expirée. Rechargez la page et réessayez.');
    }
    const ipKey = fingerprint(deps, 'login-ip', c.get('clientIp'));
    const accountKey = fingerprint(deps, 'login-account', email);
    const ipHit = await hit(db, ipKey, LOGIN_IP_LIMIT, LOGIN_WINDOW);
    const accountFailures = await peek(db, accountKey, LOGIN_WINDOW);
    if (!ipHit.allowed || accountFailures >= LOGIN_ACCOUNT_LIMIT) {
      c.header('Retry-After', String(ipHit.retryAfterSec));
      deps.log.warn({ event: 'login_throttled' }, 'admin: connexion limitée');
      return renderError('Trop de tentatives. Patientez 15 minutes avant de réessayer.', 429);
    }
    if (!email || !password || password.length > PASSWORD_MAX) {
      await hit(db, accountKey, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW);
      return renderError('Adresse e-mail ou mot de passe incorrect.');
    }
    const rows = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
    const admin = rows[0];
    // Temps constant : on vérifie un hachage factice si le compte n'existe pas.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : (await verifyPassword(password, await dummyHash()), false);
    if (!admin || !ok) {
      await hit(db, accountKey, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW);
      deps.log.warn({ event: 'login_failed' }, 'admin: échec de connexion');
      return renderError('Adresse e-mail ou mot de passe incorrect.');
    }
    await reset(db, accountKey);
    await destroySession(deps, c, { keepCookie: true }); // jamais de réutilisation d'une session existante (fixation)
    await createSession(deps, c, admin.id);
    await db.update(admins).set({ lastLoginAt: new Date() }).where(eq(admins.id, admin.id));
    await audit(db, admin.id, 'login');
    deleteCookie(c, preCookieName(config.cookieSecure), { path: '/', secure: config.cookieSecure });
    return c.redirect(next, 303);
  });

  // Toutes les autres routes : authentification + CSRF, vérifiées côté serveur.
  app.use('*', async (c, next) => {
    if (c.req.path === '/admin/connexion') return next();
    return requireAdmin()(c, next);
  });
  app.use('*', async (c, next) => {
    if (c.req.path === '/admin/connexion') return next();
    // Taille maximale vérifiée AVANT toute lecture du corps (y compris pour le contrôle CSRF) :
    // envois d'images = 10 fichiers max, tout le reste = 256 Ko.
    if (c.req.method !== 'POST') return requireCsrf(deps)(c, next);
    const isUpload = /^\/admin\/projets\/[0-9a-f-]{36}\/images$/.test(c.req.path) || c.req.path === '/admin/contenus/photo';
    return bodyLimit({
      maxSize: isUpload ? config.uploadMaxBytes * MAX_FILES + 1024 * 1024 : 256 * 1024,
      onError: (c) => {
        if (isUpload) {
          setFlash(c, { type: 'error', lines: ['Envoi trop volumineux. Envoyez moins d’images à la fois.'] });
          return c.redirect(c.req.path === '/admin/contenus/photo' ? '/admin/contenus#photo-equipe' : c.req.path.replace(/\/images$/, ''), 303);
        }
        return c.text('Requête trop volumineuse.', 413);
      },
    })(c, async () => {
      const refused = await requireCsrf(deps)(c, next);
      if (refused) c.res = refused;
    });
  });

  app.post('/deconnexion', async (c) => {
    const s = c.get('session')!;
    await audit(db, s.adminId, 'logout');
    await destroySession(deps, c);
    return c.redirect('/admin/connexion', 303);
  });

  /* ------------------------------------------------------------ Tableau de bord */
  app.get('/', async (c) => {
    const s = c.get('session')!;
    const [content, all, totalReq, recent, newRequests] = await Promise.all([
      getContent(db),
      listProjects(db),
      db.select({ n: count() }).from(contactRequests),
      db.select().from(contactRequests).orderBy(desc(contactRequests.createdAt)).limit(5),
      newCount(),
    ]);
    const warnings: Warning[] = [];
    if (!config.mail.configured) {
      warnings.push({
        title: 'Notification e-mail non configurée',
        detail: `Les demandes sont bien enregistrées ici, mais aucun e-mail n’est envoyé. Variables manquantes : ${config.mail.missing.join(', ')}.`,
        href: '/admin/compte',
        linkLabel: 'Voir la configuration',
      });
    }
    const legal = missingLegal(content);
    if (legal.length) {
      warnings.push({ title: 'Informations légales incomplètes', detail: legal.map((l) => l.label).join(', '), href: '/admin/contenus', linkLabel: 'Compléter' });
    }
    const demo = all.filter((p) => p.isDemo && p.published);
    if (demo.length) {
      warnings.push({
        title: `${demo.length} projet(s) de démonstration publié(s)`,
        detail: 'Remplacez-les par vos vrais projets, puis dépubliez ou supprimez les démonstrations.',
        href: '/admin/projets',
        linkLabel: 'Gérer les projets',
      });
    }
    // Conversion : contenus à remplir avec des données RÉELLES (sections masquées sur le site tant qu'elles sont vides).
    const todo: string[] = [];
    if (!content.contact.bookingUrl) todo.push('lien de prise de rendez-vous (les boutons affichent « Demander un diagnostic » et mènent au formulaire)');
    if (!content.team.name.trim() || !content.team.text.trim()) todo.push('section « Derrière Nexora » (masquée)');
    if (!rows(content.proof, 'item', 4, ['Value', 'Label'] as const).some((r) => r.Value && r.Label)) todo.push('chiffres de preuve sociale (bande masquée)');
    if (!rows(content.testimonials, 't', 3, ['Quote', 'Author'] as const).some((r) => r.Quote && r.Author)) todo.push('témoignages clients (section masquée)');
    if (!all.some((p) => p.published && !p.isDemo)) todo.push('projets clients avec résultats vérifiables (section « Résultats clients » masquée)');
    else if (all.some((p) => p.published && !p.isDemo && !p.results.trim())) todo.push('résultats vérifiables des projets clients');
    if (todo.length) {
      warnings.push({ title: 'Contenus de conversion à compléter', detail: `${todo.join(' ; ')}.`, href: '/admin/contenus', linkLabel: 'Compléter' });
    }
    const missingAlt = all.filter((p) => p.published && p.images.some((i) => !i.alt.trim()));
    if (missingAlt.length) {
      warnings.push({ title: 'Textes alternatifs manquants', detail: missingAlt.map((p) => p.name).join(', '), href: `/admin/projets/${missingAlt[0].id}`, linkLabel: 'Compléter' });
    }
    for (const w of config.warnings) warnings.push({ title: 'Configuration serveur', detail: w });
    return html(
      c,
      <DashboardPage
        session={s}
        assets={assets}
        flash={takeFlash(c)}
        newRequests={newRequests}
        stats={{ published: all.filter((p) => p.published).length, total: all.length, requests: Number(totalReq[0]?.n ?? 0) }}
        warnings={warnings}
        recent={recent}
      />,
    );
  });

  /* ------------------------------------------------------------ Projets */
  app.get('/projets', async (c) => {
    const s = c.get('session')!;
    return html(c, <ProjectsPage session={s} assets={assets} flash={takeFlash(c)} newRequests={await newCount()} projects={await listProjects(db)} />);
  });

  app.post('/projets', async (c) => {
    const s = c.get('session')!;
    const m = await db.select({ m: max(projects.sortOrder) }).from(projects);
    const rows = await db
      .insert(projects)
      .values({ name: 'Nouveau projet', sortOrder: Number(m[0]?.m ?? 0) + 1, published: false })
      .returning({ id: projects.id });
    await audit(db, s.adminId, 'project.create', rows[0].id);
    setFlash(c, { type: 'info', lines: ['Projet créé (brouillon). Complétez les informations et ajoutez des images, puis publiez-le.'] });
    return c.redirect(`/admin/projets/${rows[0].id}`, 303);
  });

  async function loadProject(c: Context<AppEnv>) {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return null;
    return getProject(db, id);
  }
  const notFound = (c: Context<AppEnv>) =>
    c.html(renderHtml(<AdminErrorPage assets={assets} title="Introuvable" message="Cet élément n’existe pas ou a été supprimé." />), 404);

  app.get('/projets/:id', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const values: ProjectFormValues = {
      name: p.name,
      category: p.category,
      description: p.description,
      url: p.url ?? '',
      challenge: p.challenge,
      solution: p.solution,
      principles: p.principles,
      results: p.results,
      testimonialQuote: p.testimonialQuote,
      testimonialAuthor: p.testimonialAuthor,
      caseUrl: p.caseUrl ?? '',
      published: p.published,
      isDemo: p.isDemo,
      featuredPosition: p.featuredPosition ? String(p.featuredPosition) : '',
    };
    return html(
      c,
      <ProjectEditPage session={s} assets={assets} flash={takeFlash(c)} newRequests={await newCount()} project={p} values={values} maxMb={Math.round(config.uploadMaxBytes / 1048576)} />,
    );
  });

  async function setFeatured(projectId: string, position: number | null) {
    await db.transaction(async (tx) => {
      if (position != null) {
        await tx.update(projects).set({ featuredPosition: null }).where(and(eq(projects.featuredPosition, position), ne(projects.id, projectId)));
      }
      await tx.update(projects).set({ featuredPosition: position, updatedAt: new Date() }).where(eq(projects.id, projectId));
    });
  }

  app.post('/projets/:id', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const body = await c.req.parseBody();
    const raw = {
      name: String(body.name ?? ''),
      category: String(body.category ?? ''),
      description: String(body.description ?? ''),
      url: String(body.url ?? ''),
      challenge: String(body.challenge ?? '').replace(/\r\n/g, '\n'),
      solution: String(body.solution ?? '').replace(/\r\n/g, '\n'),
      principles: String(body.principles ?? '').replace(/\r\n/g, '\n'),
      results: String(body.results ?? '').replace(/\r\n/g, '\n'),
      testimonialQuote: String(body.testimonialQuote ?? '').replace(/\r\n/g, '\n'),
      testimonialAuthor: String(body.testimonialAuthor ?? ''),
      caseUrl: String(body.caseUrl ?? ''),
      featuredPosition: String(body.featuredPosition ?? ''),
      published: body.published === '1',
      isDemo: body.isDemo === '1',
    };
    const parsed = projectFormSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
      return html(
        c,
        <ProjectEditPage
          session={s}
          assets={assets}
          flash={{ type: 'error', lines: ['Certains champs sont à corriger.'] }}
          newRequests={await newCount()}
          project={p}
          values={raw}
          errors={errors}
          maxMb={Math.round(config.uploadMaxBytes / 1048576)}
        />,
        422,
      );
    }
    const v = parsed.data;
    await db
      .update(projects)
      .set({
        name: v.name,
        category: v.category,
        description: v.description,
        url: v.url || null,
        challenge: v.challenge,
        solution: v.solution,
        principles: v.principles,
        results: v.results,
        testimonialQuote: v.testimonialQuote,
        testimonialAuthor: v.testimonialAuthor,
        caseUrl: v.caseUrl || null,
        published: v.published,
        isDemo: v.isDemo,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, p.id));
    await setFeatured(p.id, v.featuredPosition ? Number(v.featuredPosition) : null);
    await audit(db, s.adminId, 'project.update', p.id);
    await published();
    const lines = ['Projet enregistré.'];
    if (v.published && p.images.length === 0) lines.push('Ce projet n’a pas encore d’image : un visuel neutre est affiché sur le site.');
    setFlash(c, { type: 'ok', lines });
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });

  app.post('/projets/:id/publication', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const body = await c.req.parseBody();
    const value = body.published === '1';
    await db.update(projects).set({ published: value, updatedAt: new Date() }).where(eq(projects.id, p.id));
    await audit(db, s.adminId, value ? 'project.publish' : 'project.unpublish', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: [value ? `« ${p.name} » est publié.` : `« ${p.name} » est dépublié.`] });
    return c.redirect('/admin/projets', 303);
  });

  app.post('/projets/:id/accueil', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const body = await c.req.parseBody();
    const pos = String(body.position ?? '');
    if (!['', '1', '2', '3'].includes(pos)) return c.text('Position invalide.', 400);
    await setFeatured(p.id, pos ? Number(pos) : null);
    await audit(db, s.adminId, 'project.feature', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: [pos ? `« ${p.name} » est en position ${pos} sur l’accueil.` : `« ${p.name} » n’est plus mis en avant.`] });
    return c.redirect('/admin/projets', 303);
  });

  app.post('/projets/:id/deplacer', async (c) => {
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const body = await c.req.parseBody();
    const up = body.direction === 'up';
    const neighbor = await db
      .select()
      .from(projects)
      .where(up ? lt(projects.sortOrder, p.sortOrder) : gt(projects.sortOrder, p.sortOrder))
      .orderBy(up ? desc(projects.sortOrder) : asc(projects.sortOrder))
      .limit(1);
    if (neighbor[0]) {
      await db.transaction(async (tx) => {
        await tx.update(projects).set({ sortOrder: neighbor[0].sortOrder }).where(eq(projects.id, p.id));
        await tx.update(projects).set({ sortOrder: p.sortOrder }).where(eq(projects.id, neighbor[0].id));
      });
      await published();
    }
    return c.redirect('/admin/projets', 303);
  });

  app.post('/projets/:id/supprimer', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    await db.delete(projects).where(eq(projects.id, p.id));
    for (const img of p.images) await deps.storage.deletePrefix(img.storagePrefix).catch(() => {});
    await deps.storage.deletePrefix(`projects/${p.id}`).catch(() => {});
    await audit(db, s.adminId, 'project.delete', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: [`Projet « ${p.name} » supprimé.`] });
    return c.redirect('/admin/projets', 303);
  });

  /* ------------------------------------------------------------ Images */
  app.post(
    '/projets/:id/images',
    async (c) => {
      const s = c.get('session')!;
      const p = await loadProject(c);
      if (!p) return notFound(c);
      const body = await c.req.parseBody({ all: true });
      const files = ([] as unknown[]).concat(body.images ?? []).filter((f): f is File => f instanceof File && f.size > 0);
      if (!files.length) {
        setFlash(c, { type: 'error', lines: ['Aucune image sélectionnée.'] });
        return c.redirect(`/admin/projets/${p.id}`, 303);
      }
      if (files.length > MAX_FILES) {
        setFlash(c, { type: 'error', lines: [`${MAX_FILES} images maximum par envoi.`] });
        return c.redirect(`/admin/projets/${p.id}`, 303);
      }
      let order = p.images.reduce((m, i) => Math.max(m, i.sortOrder), 0);
      const ok: string[] = [];
      const ko: string[] = [];
      for (const file of files) {
        const label = (file.name || 'image').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 80) || 'image';
        try {
          const processed = await processAndStoreImage(deps.storage, p.id, Buffer.from(await file.arrayBuffer()), config.uploadMaxBytes);
          order += 1;
          await db.insert(projectImages).values({
            id: processed.id,
            projectId: p.id,
            sortOrder: order,
            alt: '',
            width: processed.width,
            height: processed.height,
            storagePrefix: processed.storagePrefix,
            variants: processed.variants,
            bytes: processed.bytes,
          });
          ok.push(label);
        } catch (e) {
          if (e instanceof ImageRejected) ko.push(`${label} : ${e.message}`);
          else {
            deps.log.error({ err: (e as Error).message }, 'upload: traitement impossible');
            ko.push(`${label} : traitement impossible.`);
          }
        }
      }
      if (ok.length) {
        await audit(db, s.adminId, 'image.upload', p.id);
        await published();
      }
      const lines: string[] = [];
      if (ok.length) lines.push(`${ok.length} image(s) ajoutée(s). Pensez à renseigner leur texte alternatif.`);
      lines.push(...ko);
      setFlash(c, { type: ko.length ? 'error' : 'ok', lines });
      return c.redirect(`/admin/projets/${p.id}`, 303);
    },
  );

  app.post('/projets/:id/images/textes', async (c) => {
    const s = c.get('session')!;
    const p = await loadProject(c);
    if (!p) return notFound(c);
    const body = await c.req.parseBody();
    for (const img of p.images) {
      const v = body[`alt:${img.id}`];
      if (typeof v === 'string') {
        await db.update(projectImages).set({ alt: v.trim().slice(0, 200) }).where(eq(projectImages.id, img.id));
      }
    }
    await audit(db, s.adminId, 'image.alt', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: ['Textes alternatifs enregistrés.'] });
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });

  async function loadImage(c: Context<AppEnv>) {
    const p = await loadProject(c);
    const imageId = c.req.param('imageId') ?? '';
    if (!p || !UUID_RE.test(imageId)) return null;
    const idx = p.images.findIndex((i) => i.id === imageId);
    return idx >= 0 ? { p, img: p.images[idx], idx } : null;
  }

  app.post('/projets/:id/images/:imageId/deplacer', async (c) => {
    const found = await loadImage(c);
    if (!found) return notFound(c);
    const { p, idx } = found;
    const body = await c.req.parseBody();
    const target = body.direction === 'up' ? idx - 1 : idx + 1;
    if (target >= 0 && target < p.images.length) {
      // Ordre affiché (couverture comprise) réécrit en entier : simple et sans ambiguïté.
      const list = [...p.images];
      [list[idx], list[target]] = [list[target], list[idx]];
      await db.transaction(async (tx) => {
        for (const [i, img] of list.entries()) await tx.update(projectImages).set({ sortOrder: i + 1 }).where(eq(projectImages.id, img.id));
        // La première image de la liste devient la couverture.
        await tx.update(projects).set({ coverImageId: list[0].id, updatedAt: new Date() }).where(eq(projects.id, p.id));
      });
      await published();
    }
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });

  app.post('/projets/:id/images/:imageId/couverture', async (c) => {
    const s = c.get('session')!;
    const found = await loadImage(c);
    if (!found) return notFound(c);
    const { p, img } = found;
    const list = [img, ...p.images.filter((i) => i.id !== img.id)];
    await db.transaction(async (tx) => {
      for (const [i, it] of list.entries()) await tx.update(projectImages).set({ sortOrder: i + 1 }).where(eq(projectImages.id, it.id));
      await tx.update(projects).set({ coverImageId: img.id, updatedAt: new Date() }).where(eq(projects.id, p.id));
    });
    await audit(db, s.adminId, 'image.cover', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: ['Image de couverture mise à jour.'] });
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });

  app.post('/projets/:id/images/:imageId/supprimer', async (c) => {
    const s = c.get('session')!;
    const found = await loadImage(c);
    if (!found) return notFound(c);
    const { p, img } = found;
    await db.delete(projectImages).where(eq(projectImages.id, img.id));
    if (p.coverImageId === img.id) await db.update(projects).set({ coverImageId: null }).where(eq(projects.id, p.id));
    await deps.storage.deletePrefix(img.storagePrefix).catch((e) => deps.log.warn({ err: (e as Error).message }, 'stockage: suppression incomplète'));
    await audit(db, s.adminId, 'image.delete', p.id);
    await published();
    setFlash(c, { type: 'ok', lines: ['Image supprimée.'] });
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });

  /* ------------------------------------------------------------ Contenus */
  app.get('/contenus', async (c) => {
    const s = c.get('session')!;
    return html(
      c,
      <ContentPage
        session={s}
        assets={assets}
        flash={takeFlash(c)}
        newRequests={await newCount()}
        values={await getContent(db)}
        teamPhoto={await getTeamPhoto(db)}
        maxMb={Math.round(config.uploadMaxBytes / 1048576)}
      />,
    );
  });

  /** Photo de la section « Derrière Nexora » : même traitement que les images de projets (vérifiée, nettoyée, AVIF + WebP). */
  app.post('/contenus/photo', async (c) => {
    const s = c.get('session')!;
    const body = await c.req.parseBody();
    const file = body.photo;
    if (!(file instanceof File) || !file.size) {
      setFlash(c, { type: 'error', lines: ['Aucune photo sélectionnée.'] });
      return c.redirect('/admin/contenus#photo-equipe', 303);
    }
    try {
      const img = await processAndStoreImage(deps.storage, 'equipe', Buffer.from(await file.arrayBuffer()), config.uploadMaxBytes);
      const previous = await getTeamPhoto(db);
      await setTeamPhoto(db, { id: img.id, width: img.width, height: img.height, storagePrefix: img.storagePrefix, variants: img.variants });
      if (previous) await deps.storage.deletePrefix(previous.storagePrefix).catch(() => {});
      await audit(db, s.adminId, 'team.photo');
      await published();
      setFlash(c, { type: 'ok', lines: ['Photo enregistrée. Pensez à renseigner sa description (texte alternatif).'] });
    } catch (e) {
      setFlash(c, { type: 'error', lines: [e instanceof ImageRejected ? e.message : 'Traitement de la photo impossible.'] });
    }
    return c.redirect('/admin/contenus#photo-equipe', 303);
  });

  app.post('/contenus/photo/supprimer', async (c) => {
    const s = c.get('session')!;
    const previous = await getTeamPhoto(db);
    if (previous) {
      await setTeamPhoto(db, null);
      await deps.storage.deletePrefix(previous.storagePrefix).catch(() => {});
      await audit(db, s.adminId, 'team.photo.delete');
      await published();
    }
    setFlash(c, { type: 'ok', lines: ['Photo supprimée.'] });
    return c.redirect('/admin/contenus#photo-equipe', 303);
  });

  app.post('/contenus', async (c) => {
    const s = c.get('session')!;
    const body = await c.req.parseBody();
    const current = await getContent(db);
    const next = structuredClone(current) as Record<string, Record<string, string>>;
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string' || !k.includes('.')) continue;
      const [section, field] = k.split('.', 2);
      // Object.hasOwn : jamais de clé héritée (__proto__, constructor…).
      if (Object.hasOwn(next, section) && Object.hasOwn(next[section], field)) next[section][field] = v.replace(/\r\n/g, '\n');
    }
    const parsed = contentSchema.safeParse(next);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const key = i.path.join('.');
        errors[key] ??= i.code === 'too_small' ? 'Ce champ est obligatoire.' : i.code === 'too_big' ? 'Texte trop long.' : 'Valeur invalide.';
      }
      return html(
        c,
        <ContentPage
          session={s}
          assets={assets}
          flash={{ type: 'error', lines: ['Rien n’a été publié : certains champs sont à corriger.'] }}
          newRequests={await newCount()}
          values={next as unknown as SiteContent}
          errors={errors}
          teamPhoto={await getTeamPhoto(db)}
        />,
        422,
      );
    }
    await saveContent(db, parsed.data);
    await audit(db, s.adminId, 'content.update');
    await published();
    setFlash(c, { type: 'ok', lines: ['Contenus enregistrés et publiés.'] });
    return c.redirect('/admin/contenus', 303);
  });

  /* ------------------------------------------------------------ Demandes */
  const PAGE_SIZE = 50;
  app.get('/demandes', async (c) => {
    const s = c.get('session')!;
    const statusQ = c.req.query('statut') ?? 'all';
    const status = ['new', 'in_progress', 'done'].includes(statusQ) ? (statusQ as 'new' | 'in_progress' | 'done') : 'all';
    const page = Math.max(1, Math.min(10_000, Number(c.req.query('page')) || 1));
    const where = status === 'all' ? undefined : eq(contactRequests.status, status);
    const [rows, grouped] = await Promise.all([
      db.select().from(contactRequests).where(where).orderBy(desc(contactRequests.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db.select({ status: contactRequests.status, n: count() }).from(contactRequests).groupBy(contactRequests.status),
    ]);
    const counts: Record<string, number> = { all: 0 };
    for (const g of grouped) {
      counts[g.status] = Number(g.n);
      counts.all += Number(g.n);
    }
    const total = status === 'all' ? counts.all : counts[status] ?? 0;
    return html(
      c,
      <RequestsPage
        session={s}
        assets={assets}
        flash={takeFlash(c)}
        newRequests={counts.new ?? 0}
        rows={rows}
        status={status}
        counts={counts}
        page={page}
        pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      />,
    );
  });

  async function loadRequest(c: Context<AppEnv>) {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return null;
    const rows = await db.select().from(contactRequests).where(eq(contactRequests.id, id)).limit(1);
    return rows[0] ?? null;
  }

  app.get('/demandes/:id', async (c) => {
    const s = c.get('session')!;
    const row = await loadRequest(c);
    if (!row) return notFound(c);
    return html(c, <RequestDetailPage session={s} assets={assets} flash={takeFlash(c)} newRequests={await newCount()} row={row} mailConfigured={config.mail.configured} />);
  });

  app.post('/demandes/:id/statut', async (c) => {
    const s = c.get('session')!;
    const row = await loadRequest(c);
    if (!row) return notFound(c);
    const body = await c.req.parseBody();
    const status = String(body.status ?? '');
    if (status !== 'new' && status !== 'in_progress' && status !== 'done') return c.text('Statut invalide.', 400);
    await db.update(contactRequests).set({ status, updatedAt: new Date() }).where(eq(contactRequests.id, row.id));
    await audit(db, s.adminId, 'request.status', row.id);
    setFlash(c, { type: 'ok', lines: ['Statut mis à jour.'] });
    return c.redirect(`/admin/demandes/${row.id}`, 303);
  });

  app.post('/demandes/:id/supprimer', async (c) => {
    const s = c.get('session')!;
    const row = await loadRequest(c);
    if (!row) return notFound(c);
    await db.delete(contactRequests).where(eq(contactRequests.id, row.id));
    await audit(db, s.adminId, 'request.delete', row.id);
    setFlash(c, { type: 'ok', lines: ['Demande supprimée.'] });
    return c.redirect('/admin/demandes', 303);
  });

  /* ------------------------------------------------------------ Compte */
  const accountConfig = () => ({
    mail: { configured: config.mail.configured, provider: config.mail.provider, missing: config.mail.missing },
    storage: config.storage.driver === 's3' ? `Compatible S3 (${new URL(config.storage.endpoint).hostname})` : 'Disque local (dossier persistant)',
    database: config.databaseUrl.startsWith('pglite:') ? 'PostgreSQL embarqué (PGlite)' : 'PostgreSQL',
  });

  app.get('/compte', async (c) => {
    const s = c.get('session')!;
    return html(c, <AccountPage session={s} assets={assets} flash={takeFlash(c)} newRequests={await newCount()} config={accountConfig()} />);
  });

  app.post('/compte/mot-de-passe', async (c) => {
    const s = c.get('session')!;
    const body = await c.req.parseBody();
    const current = String(body.current ?? '');
    const next = String(body.next ?? '');
    const confirm = String(body.confirm ?? '');
    const errors: Record<string, string> = {};
    const rl = await hit(db, fingerprint(deps, 'pw-change', s.adminId), 10, LOGIN_WINDOW);
    const rows = await db.select().from(admins).where(eq(admins.id, s.adminId)).limit(1);
    if (!rl.allowed) errors.current = 'Trop de tentatives. Réessayez plus tard.';
    else if (!rows[0] || current.length > PASSWORD_MAX || !(await verifyPassword(current, rows[0].passwordHash))) errors.current = 'Mot de passe actuel incorrect.';
    if (next.length < PASSWORD_MIN) errors.next = `${PASSWORD_MIN} caractères minimum.`;
    else if (next.length > PASSWORD_MAX) errors.next = 'Mot de passe trop long.';
    else if (next === current) errors.next = 'Le nouveau mot de passe doit être différent.';
    if (confirm !== next) errors.confirm = 'Les deux mots de passe ne correspondent pas.';
    if (Object.keys(errors).length) {
      return html(
        c,
        <AccountPage session={s} assets={assets} flash={{ type: 'error', lines: ['Mot de passe non modifié.'] }} newRequests={await newCount()} errors={errors} config={accountConfig()} />,
        422,
      );
    }
    await db.update(admins).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date() }).where(eq(admins.id, s.adminId));
    await destroyOtherSessions(deps, s.adminId, s.id);
    await audit(db, s.adminId, 'password.change');
    setFlash(c, { type: 'ok', lines: ['Mot de passe mis à jour. Les autres sessions ont été déconnectées.'] });
    return c.redirect('/admin/compte', 303);
  });

  return app;
}
