import type { Hono } from 'hono';
import type { AppEnv, Deps } from '../../context';
import { audit, getContent, saveContent, getTeamPhoto, setTeamPhoto } from '../../lib/repo';
import { contentSchema, type SiteContent } from '../../lib/content';
import { ImageRejected, processAndStoreImage } from '../../lib/images';
import { ContentPage } from '../../views/admin/pages';
import type { PageCache } from '../public';
import { createHelpers, createPublished, html, setFlash, takeFlash } from './shared';

export function registerContent(app: Hono<AppEnv>, deps: Deps, cache: PageCache) {
  const { db, config, assets } = deps;
  const { newCount } = createHelpers(deps);
  const published = createPublished(deps, cache);

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
}
