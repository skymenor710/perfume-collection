import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../context';
import { admins } from '../db/schema';
import { createSession, destroySession, deviceCookieName, loadSession, preCookieName, requireAdmin, requireCsrf, sameOrigin } from '../lib/auth';
import { PASSWORD_MAX, dummyHash, hmac, randomToken, safeEqual, verifyPassword } from '../lib/crypto';
import { hit, peek, reset } from '../lib/rate-limit';
import { fingerprint } from '../lib/security';
import { audit } from '../lib/repo';
import { LoginPage } from '../views/admin/pages';
import type { PageCache } from './public';
import { registerAccount } from './admin/account';
import { registerContent } from './admin/content';
import { registerDashboard } from './admin/dashboard';
import { registerImages } from './admin/images';
import { registerProjects } from './admin/projects';
import { registerRequests } from './admin/requests';
import { LOGIN_ACCOUNT_LIMIT, LOGIN_IP_LIMIT, LOGIN_KNOWN_DEVICE_LIMIT, LOGIN_WINDOW, MAX_FILES, html, safeNext, setFlash } from './admin/shared';

export function adminRoutes(deps: Deps, cache: PageCache) {
  const { db, config, assets } = deps;
  const app = new Hono<AppEnv>();

  app.use('*', loadSession(deps));
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

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
    const pairKey = fingerprint(deps, 'login-pair', `${email}|${c.get('clientIp')}`);
    const rows = email ? await db.select().from(admins).where(eq(admins.email, email)).limit(1) : [];
    const admin = rows[0];
    // Verrouillage sans déni de service : un tiers qui connaît l'e-mail peut bloquer les NOUVEAUX appareils
    // (échecs du compte, toutes IP confondues), pas l'appareil où l'administrateur s'est déjà connecté ; celui-ci
    // reste limité par ses propres échecs (couple e-mail + IP), par un plafond global plus haut et par son IP.
    // L'empreinte dépend du hachage du mot de passe : changer de mot de passe révoque tous les appareils connus.
    const deviceProof = admin ? hmac(config.sessionSecret, `device:${admin.id}:${admin.passwordHash}`).slice(0, 43) : '';
    const knownDevice = !!deviceProof && safeEqual(getCookie(c, deviceCookieName(config.cookieSecure)) ?? '', deviceProof);
    const ipHit = await hit(db, ipKey, LOGIN_IP_LIMIT, LOGIN_WINDOW);
    const accountFailures = await peek(db, accountKey, LOGIN_WINDOW);
    const blocked = knownDevice
      ? accountFailures >= LOGIN_KNOWN_DEVICE_LIMIT || (await peek(db, pairKey, LOGIN_WINDOW)) >= LOGIN_ACCOUNT_LIMIT
      : accountFailures >= LOGIN_ACCOUNT_LIMIT;
    if (!ipHit.allowed || blocked) {
      c.header('Retry-After', String(ipHit.retryAfterSec));
      deps.log.warn({ event: 'login_throttled' }, 'admin: connexion limitée');
      return renderError('Trop de tentatives. Patientez 15 minutes avant de réessayer.', 429);
    }
    const recordFailure = async () => {
      await hit(db, accountKey, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW);
      await hit(db, pairKey, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW);
    };
    if (!email || !password || password.length > PASSWORD_MAX) {
      await recordFailure();
      return renderError('Adresse e-mail ou mot de passe incorrect.');
    }
    // Temps constant : on vérifie un hachage factice si le compte n'existe pas.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : (await verifyPassword(password, await dummyHash()), false);
    if (!admin || !ok) {
      await recordFailure();
      deps.log.warn({ event: 'login_failed' }, 'admin: échec de connexion');
      return renderError('Adresse e-mail ou mot de passe incorrect.');
    }
    await reset(db, accountKey);
    await reset(db, pairKey);
    setCookie(c, deviceCookieName(config.cookieSecure), deviceProof, { httpOnly: true, secure: config.cookieSecure, sameSite: 'Strict', path: '/', maxAge: 180 * 24 * 3600 });
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

  // Ordre d’enregistrement = ordre de correspondance de Hono : ne pas permuter ces appels.
  registerDashboard(app, deps);
  registerProjects(app, deps, cache);
  registerImages(app, deps, cache);
  registerContent(app, deps, cache);
  registerRequests(app, deps);
  registerAccount(app, deps);

  return app;
}
