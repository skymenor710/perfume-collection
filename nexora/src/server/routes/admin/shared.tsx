import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv, Deps } from '../../context';
import { contactRequests } from '../../db/schema';
import { bumpContentVersion, getProject } from '../../lib/repo';
import { renderHtml } from '../../views/render';
import type { Flash } from '../../views/admin/layout';
import { AdminErrorPage } from '../../views/admin/pages';
import type { PageCache } from '../public';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LOGIN_IP_LIMIT = 20; // tentatives / 15 min / IP
export const LOGIN_ACCOUNT_LIMIT = 8; // échecs / 15 min / compte
export const LOGIN_WINDOW = 15 * 60;
export const MAX_FILES = 10;

/* ---------- Messages flash (cookie court, seulement des textes produits par le serveur) ---------- */
export function setFlash(c: Context, flash: Flash) {
  const lines = flash.lines.map((l) => l.slice(0, 300)).slice(0, 12);
  setCookie(c, 'nx_flash', Buffer.from(JSON.stringify({ ...flash, lines })).toString('base64url'), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60,
  });
}
export function takeFlash(c: Context): Flash | null {
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


export const httpUrl = (label: string) =>
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

export const projectFormSchema = z.object({
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

export function safeNext(next: unknown) {
  if (typeof next !== 'string') return '/admin';
  return /^\/admin(\/[a-zA-Z0-9/_-]*)?$/.test(next) ? next : '/admin';
}

/** Rendu HTML d’une page d’administration (aucune dépendance à `deps`). */
export const html = (c: Context, node: Parameters<typeof renderHtml>[0], status: 200 | 400 | 404 | 422 | 429 = 200) => c.html(renderHtml(node), status);

/** Aides liées à `deps` (celles qui étaient locales à adminRoutes) : mêmes corps, créées par module. */
export function createHelpers(deps: Deps) {
  const { db, assets } = deps;
  async function newCount() {
    const r = await db.select({ n: count() }).from(contactRequests).where(eq(contactRequests.status, 'new'));
    return Number(r[0]?.n ?? 0);
  }

  async function loadProject(c: Context<AppEnv>) {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return null;
    return getProject(db, id);
  }
  const notFound = (c: Context<AppEnv>) =>
    c.html(renderHtml(<AdminErrorPage assets={assets} title="Introuvable" message="Cet élément n’existe pas ou a été supprimé." />), 404);

  return { newCount, loadProject, notFound };
}

/** `published()` : nécessite le cache de pages (utilisé par les modules qui modifient du contenu public). */
export function createPublished(deps: Deps, cache: PageCache) {
  const { db } = deps;

  /** Après toute modification visible publiquement : nouvelle version de contenu (toutes instances) + cache local vidé. */
  async function published() {
    await bumpContentVersion(db);
    cache.clear();
  }

  return published;
}
