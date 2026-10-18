import type { Context, Hono } from 'hono';
import { count, desc, eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../../context';
import { contactRequests } from '../../db/schema';
import { audit } from '../../lib/repo';
import { RequestDetailPage, RequestsPage } from '../../views/admin/pages';
import { UUID_RE, createHelpers, html, setFlash, takeFlash } from './shared';

export function registerRequests(app: Hono<AppEnv>, deps: Deps) {
  const { db, config, assets } = deps;
  const { newCount, notFound } = createHelpers(deps);

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
}
