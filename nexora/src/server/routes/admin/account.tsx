import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../../context';
import { admins } from '../../db/schema';
import { destroyOtherSessions } from '../../lib/auth';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword, verifyPassword } from '../../lib/crypto';
import { hit } from '../../lib/rate-limit';
import { fingerprint } from '../../lib/security';
import { audit } from '../../lib/repo';
import { AccountPage } from '../../views/admin/pages';
import { LOGIN_WINDOW, createHelpers, html, setFlash, takeFlash } from './shared';

export function registerAccount(app: Hono<AppEnv>, deps: Deps) {
  const { db, config, assets } = deps;
  const { newCount } = createHelpers(deps);

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
}
