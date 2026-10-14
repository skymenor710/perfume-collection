// Sauvegarde logique complète : toutes les tables utiles (JSON) + tous les fichiers des images.
//   npm run backup                 → backups/nexora-AAAA-MM-JJ-HHMMSS/
//   npm run backup -- --out /chemin/vers/dossier
// Fonctionne quel que soit le stockage (disque local ou S3/R2) et la base (PostgreSQL ou PGlite).
// Les sessions et compteurs de limitation ne sont pas sauvegardés (données temporaires).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootstrap, PROJECT_ROOT } from '../src/server/bootstrap';
import { admins, auditLog, contactRequests, contentVersion, projectImages, projects, siteSettings } from '../src/server/db/schema';

const args = process.argv.slice(2);
const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '').replace(/-(\d\d)-(\d\d)$/, '$1$2');
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(PROJECT_ROOT, 'backups', `nexora-${stamp}`));

const rt = await bootstrap({ migrate: false });
const { db, storage } = rt.deps;
const tables = {
  admins: await db.select().from(admins),
  projects: await db.select().from(projects),
  project_images: await db.select().from(projectImages),
  site_settings: await db.select().from(siteSettings),
  contact_requests: await db.select().from(contactRequests),
  content_version: await db.select().from(contentVersion),
  audit_log: await db.select().from(auditLog),
};
await mkdir(path.join(out, 'files'), { recursive: true });
const keys = await storage.list('projects/');
const manifest: { key: string; sha256: string; bytes: number }[] = [];
for (const key of keys) {
  const buf = await storage.get(key);
  if (!buf) continue;
  const dest = path.join(out, 'files', ...key.split('/'));
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  manifest.push({ key, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
}
await writeFile(path.join(out, 'database.json'), JSON.stringify({ format: 'nexora-backup-v1', createdAt: new Date().toISOString(), tables }, null, 1));
await writeFile(path.join(out, 'files.json'), JSON.stringify(manifest, null, 1));
console.log(`Sauvegarde terminée : ${out}`);
console.log(`  ${Object.entries(tables).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);
console.log(`  fichiers : ${manifest.length}`);
console.log('ATTENTION : ce dossier contient des données personnelles (demandes de contact) et les empreintes des mots de passe. Stockez-le chiffré.');
await rt.close();
