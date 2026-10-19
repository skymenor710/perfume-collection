import type { Context, Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppEnv, Deps } from '../../context';
import { projectImages, projects } from '../../db/schema';
import { audit } from '../../lib/repo';
import { errorSummary } from '../../log';
import { ImageRejected, processAndStoreImage } from '../../lib/images';
import type { PageCache } from '../public';
import { MAX_FILES, UUID_RE, createHelpers, createPublished, setFlash } from './shared';

export function registerImages(app: Hono<AppEnv>, deps: Deps, cache: PageCache) {
  const { db, config } = deps;
  const { loadProject, notFound } = createHelpers(deps);
  const published = createPublished(deps, cache);

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
            deps.log.error({ err: errorSummary(e) }, 'upload: traitement impossible');
            ko.push(`${label} : traitement impossible.`);
          }
        }
      }
      if (ok.length) {
        await published();
        await audit(db, s.adminId, 'image.upload', p.id);
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
    await published();
    await audit(db, s.adminId, 'image.alt', p.id);
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
    await published();
    await audit(db, s.adminId, 'image.cover', p.id);
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
    await deps.storage.deletePrefix(img.storagePrefix).catch((e) => deps.log.warn({ err: errorSummary(e) }, 'stockage: suppression incomplète'));
    await published();
    await audit(db, s.adminId, 'image.delete', p.id);
    setFlash(c, { type: 'ok', lines: ['Image supprimée.'] });
    return c.redirect(`/admin/projets/${p.id}`, 303);
  });
}
