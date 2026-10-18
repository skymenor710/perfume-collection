import type { Hono } from 'hono';
import { and, asc, desc, eq, gt, lt, max, ne } from 'drizzle-orm';
import type { AppEnv, Deps } from '../../context';
import { projects } from '../../db/schema';
import { audit, listProjects } from '../../lib/repo';
import { ProjectEditPage, ProjectsPage, type ProjectFormValues } from '../../views/admin/pages';
import type { PageCache } from '../public';
import { createHelpers, createPublished, html, projectFormSchema, setFlash, takeFlash } from './shared';

export function registerProjects(app: Hono<AppEnv>, deps: Deps, cache: PageCache) {
  const { db, config, assets } = deps;
  const { newCount, loadProject, notFound } = createHelpers(deps);
  const published = createPublished(deps, cache);

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
}
