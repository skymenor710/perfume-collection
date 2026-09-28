import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeLibrary } from '@perfumes/core/library';
import { config } from '../../config';
import { BACKUP_PREFIX, backupsDir, libraryFile, sha256, targetFingerprint, type BackupManifest } from '../backup';
import { resolveImageFile } from '../checks';
import { redactDbError } from '../client';
import { loadLibrary } from '../snapshot';
import { migrationStatus } from '../status';
import { describeTarget as safeTarget } from '../targets';
import { boot, connect, describeTarget, die, option } from './common';

/**
 * npm run db:backup — backup ANTES de qualquer write no banco principal. SÓ LÊ: nada é gravado em banco nenhum.
 *
 * Cria data/backups/backup-before-neon-AAAAMMDD-HHMMSS/ (fora do Git; nome único; nunca sobrescreve):
 *   library.json         cópia byte a byte do data/library.json (a fonte oficial)
 *   images.json          cada referência de imagem usada, com o SHA-256 do arquivo
 *   principal-db.json    o banco principal no formato do library.json (mesmo formato do db:export), se já tiver schema
 *   manifest.json        data, commit do Git, banco (host mascarado + impressão digital, nunca a URL), SHA-256 de tudo
 */
boot();
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace('T', '-')
  .slice(0, 15);
// --label=<nome> dá outro nome à pasta (ex.: backup-before-storage-backend-postgres-switch); o padrão é backup-before-neon.
const label = option('label', BACKUP_PREFIX.replace(/-$/, ''));
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(label)) die(`--label inválido: use letras minúsculas, números e hífens.`);
const dir = path.join(backupsDir(), `${label}-${stamp}`);
if (existsSync(dir)) die(`Já existe um backup com este nome (${path.basename(dir)}); espere um segundo e rode de novo.`);
if (!existsSync(libraryFile())) die('data/library.json não existe.');
mkdirSync(dir, { recursive: true });

// 1. A fonte oficial, byte a byte.
const libBytes = readFileSync(libraryFile());
copyFileSync(libraryFile(), path.join(dir, 'library.json'));
if (sha256(readFileSync(path.join(dir, 'library.json'))) !== sha256(libBytes)) die('A cópia do library.json não bate com o original.');

// 2. As imagens em uso, pelo conteúdo.
const library = sanitizeLibrary(JSON.parse(libBytes.toString('utf8'))).library;
const refs = new Set<string>();
for (const p of library.products) for (const i of p.images) for (const r of [i.url, i.thumbUrl, i.masterUrl]) if (r) refs.add(r);
for (const u of library.users) if (u.avatarUrl) refs.add(u.avatarUrl);
const images = [...refs].sort().map((ref) => {
  const file = resolveImageFile(ref);
  return { ref, sha256: file && existsSync(file) ? sha256(readFileSync(file)) : null };
});
writeFileSync(path.join(dir, 'images.json'), `${JSON.stringify(images, null, 2)}\n`, { flag: 'wx' });

// 3. O banco principal como está agora (só leitura).
const url = config.databaseUrl;
let principalDb: BackupManifest['principalDb'] = { file: null, state: 'DATABASE_URL não configurada', migrationsApplied: 0, counts: null, sha256: null };
let target: BackupManifest['target'] = null;
if (url) {
  const t = safeTarget(url);
  target = { host: t.host, pooled: t.pooled, database: t.database, fingerprint: targetFingerprint(url) };
  const handle = await connect(url);
  try {
    const status = await migrationStatus(handle.db);
    if (status.applied === 0) principalDb = { file: null, state: 'sem schema (nenhuma migration aplicada) — banco vazio', migrationsApplied: 0, counts: null, sha256: null };
    else {
      const db = await loadLibrary(handle.db);
      const text = `${JSON.stringify(db, null, 2)}\n`;
      writeFileSync(path.join(dir, 'principal-db.json'), text, { flag: 'wx' });
      principalDb = {
        file: 'principal-db.json',
        state: status.upToDate ? 'migrations em dia' : `faltam migrations: ${status.pending.join(', ')}`,
        migrationsApplied: status.applied,
        counts: { users: db.users.length, products: db.products.length, entries: db.entries.length },
        sha256: sha256(text),
      };
    }
  } catch (error) {
    die(`Backup interrompido ao ler o banco (nada foi gravado no banco): ${redactDbError(error, url)}`);
  } finally {
    await handle.close();
  }
}

let gitCommit: string | null = null;
try {
  gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: config.root, encoding: 'utf8' }).trim();
} catch {
  gitCommit = null;
}

const manifest: BackupManifest = {
  kind: label,
  createdAt: new Date().toISOString(),
  gitCommit,
  target,
  libraryJson: { file: 'library.json', sha256: sha256(libBytes), bytes: libBytes.length },
  images: { file: 'images.json', count: images.length, missing: images.filter((i) => !i.sha256).length },
  principalDb,
};
writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

console.log(`Backup: ${path.relative(config.root, dir)}`);
console.log(`  library.json  sha256 ${manifest.libraryJson.sha256.slice(0, 16)}… (${library.entries.length} perfumes)`);
console.log(`  imagens       ${images.length} referências, ${manifest.images.missing} faltando`);
console.log(`  banco         ${url ? describeTarget(url) : 'não configurado'} — ${principalDb.state}`);
if (manifest.images.missing) die('Há imagens faltando: o backup foi gravado, mas confira antes de continuar.');
