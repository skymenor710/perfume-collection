// Restauration d'une sauvegarde produite par `npm run backup`, dans une base VIDE (migrations appliquées).
//   npm run restore -- backups/nexora-2026-10-14-101500
// Refuse d'écraser une base qui contient déjà des projets, des demandes ou des comptes (--force pour vider d'abord).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { count, sql } from 'drizzle-orm';
import { bootstrap } from '../src/server/bootstrap';
import { admins, auditLog, contactRequests, contentVersion, projectImages, projects, siteSettings } from '../src/server/db/schema';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('Usage : npm run restore -- <dossier-de-sauvegarde> [--force]');
  process.exit(1);
}
const src = path.resolve(dir);
const data = JSON.parse(await readFile(path.join(src, 'database.json'), 'utf8'));
if (data.format !== 'nexora-backup-v1') throw new Error('Format de sauvegarde inconnu.');
const manifest: { key: string; sha256: string }[] = JSON.parse(await readFile(path.join(src, 'files.json'), 'utf8'));

const rt = await bootstrap({ migrate: true });
const { db, storage } = rt.deps;
const used = Number((await db.select({ n: count() }).from(projects))[0].n) + Number((await db.select({ n: count() }).from(contactRequests))[0].n) + Number((await db.select({ n: count() }).from(admins))[0].n);
if (used > 0 && !args.includes('--force')) {
  console.error('La base cible contient déjà des données. Utilisez --force pour la vider avant restauration.');
  await rt.close();
  process.exit(1);
}

// Dates : JSON → Date pour les colonnes horodatées.
const revive = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /At$|^at$/.test(k) ? new Date(v) : v])));

// Fichiers d'abord (vérifiés par empreinte), base ensuite : une base restaurée ne pointe jamais vers un fichier absent.
for (const f of manifest) {
  const buf = await readFile(path.join(src, 'files', ...f.key.split('/')));
  if (createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error(`Fichier corrompu : ${f.key}`);
  await storage.put(f.key, buf, f.key.endsWith('.avif') ? 'image/avif' : 'image/webp');
}

await db.transaction(async (tx) => {
  await tx.execute(sql`truncate table audit_log, sessions, project_images, projects, contact_requests, site_settings, admins, rate_limits cascade`);
  const t = data.tables;
  if (t.admins.length) await tx.insert(admins).values(revive(t.admins) as never);
  if (t.projects.length) await tx.insert(projects).values(revive(t.projects) as never);
  if (t.project_images.length) await tx.insert(projectImages).values(revive(t.project_images) as never);
  if (t.site_settings.length) await tx.insert(siteSettings).values(revive(t.site_settings) as never);
  if (t.contact_requests.length) await tx.insert(contactRequests).values(revive(t.contact_requests) as never);
  if (t.audit_log.length) await tx.insert(auditLog).values(revive(t.audit_log) as never);
  await tx.delete(contentVersion);
  await tx.insert(contentVersion).values({ id: 1, version: Number(t.content_version?.[0]?.version ?? 1) + 1 });
});
console.log(`Restauration terminée depuis ${src} (${manifest.length} fichiers).`);
await rt.close();
