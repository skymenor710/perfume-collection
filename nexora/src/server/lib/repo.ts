import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { auditLog, contentVersion, projectImages, projects, siteSettings } from '../db/schema';
import { frTypo, mergeContent, type SiteContent } from './content';

export type ProjectRow = typeof projects.$inferSelect;
export type ImageRow = typeof projectImages.$inferSelect;
export interface ProjectWithImages extends ProjectRow {
  images: ImageRow[];
}

export async function getContent(db: Db): Promise<SiteContent> {
  const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, 'content')).limit(1);
  return mergeContent(rows[0]?.value);
}

export async function saveContent(db: Db, content: SiteContent) {
  await db
    .insert(siteSettings)
    .values({ key: 'content', value: content })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: content, updatedAt: new Date() } });
}

/** Images triées : la couverture d'abord, puis l'ordre défini dans l'admin. */
export function orderImages(p: ProjectRow, images: ImageRow[]) {
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  const coverIdx = p.coverImageId ? sorted.findIndex((i) => i.id === p.coverImageId) : -1;
  if (coverIdx > 0) sorted.unshift(...sorted.splice(coverIdx, 1));
  return sorted;
}

export async function attachImages(db: Db, list: ProjectRow[]): Promise<ProjectWithImages[]> {
  if (!list.length) return [];
  const imgs = await db
    .select()
    .from(projectImages)
    .where(inArray(projectImages.projectId, list.map((p) => p.id)))
    .orderBy(asc(projectImages.sortOrder), asc(projectImages.createdAt));
  return list.map((p) => ({ ...p, images: orderImages(p, imgs.filter((i) => i.projectId === p.id)) }));
}

/**
 * Projets de la page d'accueil, en deux groupes qui ne se mélangent jamais :
 *  - `results` : projets CLIENTS publiés (is_demo = false) → section « Résultats clients » ;
 *  - `concepts` : concepts / démonstrations publiés → section « Nos concepts ».
 * Ordre : position mise en avant (1 à 3) puis ordre de l'admin ; 3 projets au plus par groupe.
 */
export async function getHomeProjects(db: Db): Promise<{ results: ProjectWithImages[]; concepts: ProjectWithImages[] }> {
  const published = await db
    .select()
    .from(projects)
    .where(eq(projects.published, true))
    .orderBy(asc(projects.sortOrder), asc(projects.createdAt));
  const ordered = [...published].sort((a, b) => (a.featuredPosition ?? 99) - (b.featuredPosition ?? 99));
  const results = ordered.filter((p) => !p.isDemo).slice(0, 3);
  const concepts = ordered.filter((p) => p.isDemo).slice(0, 3);
  const all = await attachImages(db, [...results, ...concepts]);
  return { results: all.slice(0, results.length), concepts: all.slice(results.length) };
}

/** Projet prêt à afficher : typographie française sur les textes (liens inchangés). */
export function displayProject(p: ProjectWithImages): ProjectWithImages {
  return {
    ...p,
    name: frTypo(p.name),
    category: frTypo(p.category),
    description: frTypo(p.description),
    challenge: frTypo(p.challenge),
    solution: frTypo(p.solution),
    principles: frTypo(p.principles),
    results: frTypo(p.results),
    testimonialQuote: frTypo(p.testimonialQuote),
    testimonialAuthor: frTypo(p.testimonialAuthor),
    images: p.images.map((i) => ({ ...i, alt: frTypo(i.alt) })),
  };
}

/** Un projet client compte comme « résultat » seulement s'il a des résultats vérifiables renseignés. */
export const hasVerifiedResults = (p: ProjectRow) => !p.isDemo && p.results.trim().length > 0;

/** Photo de la section « Derrière Nexora » (envoyée dans l'admin, mêmes variantes que les images de projets). */
export interface TeamPhoto {
  id: string;
  width: number;
  height: number;
  storagePrefix: string;
  variants: ImageRow['variants'];
}

export async function getTeamPhoto(db: Db): Promise<TeamPhoto | null> {
  const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, 'teamPhoto')).limit(1);
  const v = rows[0]?.value as TeamPhoto | undefined;
  return v && typeof v.id === 'string' && Array.isArray(v.variants) ? v : null;
}

export async function setTeamPhoto(db: Db, photo: TeamPhoto | null) {
  if (!photo) {
    await db.delete(siteSettings).where(eq(siteSettings.key, 'teamPhoto'));
    return;
  }
  await db
    .insert(siteSettings)
    .values({ key: 'teamPhoto', value: photo })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: photo, updatedAt: new Date() } });
}

export async function listProjects(db: Db) {
  const list = await db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.createdAt));
  return attachImages(db, list);
}

export async function getProject(db: Db, id: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!rows[0]) return null;
  return (await attachImages(db, rows))[0];
}

export async function getContentVersion(db: Db): Promise<number> {
  const rows = await db.select({ v: contentVersion.version }).from(contentVersion).where(eq(contentVersion.id, 1)).limit(1);
  return rows[0]?.v ?? 0;
}

/** À appeler après toute modification visible sur le site : invalide le cache de toutes les instances. */
export async function bumpContentVersion(db: Db) {
  await db
    .insert(contentVersion)
    .values({ id: 1, version: 2 })
    .onConflictDoUpdate({ target: contentVersion.id, set: { version: sql`${contentVersion.version} + 1`, updatedAt: new Date() } });
}

export async function audit(db: Db, adminId: string | null, action: string, target?: string) {
  await db.insert(auditLog).values({ adminId, action, target: target ?? null });
}
