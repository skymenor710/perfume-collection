import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Deps, SessionInfo } from '../context';
import { admins, sessions } from '../db/schema';
import { randomToken, safeEqual, sha256 } from './crypto';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // durée absolue : 12 h
const IDLE_MS = 2 * 60 * 60 * 1000; // inactivité : 2 h

export function sessionCookieName(secure: boolean) {
  // Préfixe __Host- : cookie limité à l'origine exacte, chemin /, attribut Secure obligatoire.
  return secure ? '__Host-nx_session' : 'nx_session';
}
export function preCookieName(secure: boolean) {
  return secure ? '__Host-nx_pre' : 'nx_pre';
}

export async function createSession(deps: Deps, c: Context, adminId: string) {
  const token = randomToken(32);
  const now = Date.now();
  await deps.db.insert(sessions).values({
    id: sha256(token),
    adminId,
    csrfToken: randomToken(24),
    expiresAt: new Date(now + SESSION_TTL_MS),
  });
  setCookie(c, sessionCookieName(deps.config.cookieSecure), token, {
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(deps: Deps, c: Context, opts: { keepCookie?: boolean } = {}) {
  const token = getCookie(c, sessionCookieName(deps.config.cookieSecure));
  if (token) await deps.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  if (!opts.keepCookie) deleteCookie(c, sessionCookieName(deps.config.cookieSecure), { path: '/', secure: deps.config.cookieSecure });
}

export async function destroyOtherSessions(deps: Deps, adminId: string, keepId: string) {
  await deps.db.delete(sessions).where(and(eq(sessions.adminId, adminId), ne(sessions.id, keepId)));
}

export async function purgeExpiredSessions(deps: Deps) {
  await deps.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Charge la session (si présente et valide) dans c.var.session. N'impose rien : voir requireAdmin. */
export function loadSession(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('session', null);
    const token = getCookie(c, sessionCookieName(deps.config.cookieSecure));
    if (token && token.length <= 128) {
      const id = sha256(token);
      const rows = await deps.db
        .select({ id: sessions.id, adminId: sessions.adminId, csrfToken: sessions.csrfToken, lastSeenAt: sessions.lastSeenAt, email: admins.email })
        .from(sessions)
        .innerJoin(admins, eq(admins.id, sessions.adminId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
        .limit(1);
      const row = rows[0];
      if (row && Date.now() - row.lastSeenAt.getTime() < IDLE_MS) {
        const info: SessionInfo = { id: row.id, adminId: row.adminId, email: row.email, csrfToken: row.csrfToken };
        c.set('session', info);
        if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
          await deps.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
        }
      } else if (row) {
        await deps.db.delete(sessions).where(eq(sessions.id, id));
      }
    }
    await next();
  };
}

/** Toute route d'administration (sauf la connexion) passe par ici : contrôle côté serveur, jamais côté client. */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = c.get('session');
    if (!s) {
      if (c.req.method === 'GET' && !c.req.header('x-requested-with')) {
        const next_ = c.req.path.startsWith('/admin') ? `?next=${encodeURIComponent(c.req.path)}` : '';
        return c.redirect(`/admin/connexion${next_}`, 303);
      }
      return c.json({ error: 'Authentification requise.' }, 401);
    }
    c.header('Cache-Control', 'no-store');
    await next();
  };
}

/**
 * Protection CSRF des requêtes authentifiées qui modifient des données :
 *  1. l'origine doit être celle du site (en-têtes Origin / Sec-Fetch-Site) ;
 *  2. un jeton secret lié à la session (champ _csrf ou en-tête x-csrf-token) doit correspondre.
 * Le cookie de session est en plus SameSite=Lax.
 */
export function requireCsrf(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    if (!sameOrigin(c, deps.config.publicOrigin)) return c.text('Origine refusée.', 403);
    const s = c.get('session');
    if (!s) return c.text('Authentification requise.', 401);
    let token = c.req.header('x-csrf-token') ?? '';
    if (!token) {
      const ct = c.req.header('content-type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const body = await c.req.parseBody({ all: true });
        const v = body['_csrf'];
        token = typeof v === 'string' ? v : '';
      }
    }
    if (!token || !safeEqual(token, s.csrfToken)) return c.text('Jeton de sécurité invalide. Rechargez la page.', 403);
    await next();
  };
}

export function sameOrigin(c: Context, publicOrigin: string) {
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = c.req.header('origin');
  if (origin) {
    if (origin === 'null') return false;
    const reqOrigin = new URL(c.req.url).origin;
    return origin === publicOrigin || origin === reqOrigin;
  }
  const referer = c.req.header('referer');
  if (referer) {
    try {
      const o = new URL(referer).origin;
      return o === publicOrigin || o === new URL(c.req.url).origin;
    } catch {
      return false;
    }
  }
  // Ni Origin ni Referer (rare : clients non navigateurs) : le jeton CSRF reste exigé.
  return true;
}
