import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { describeTarget } from './targets';

/**
 * Backup ANTES do primeiro write no banco principal (pasta data/backups/backup-before-neon-AAAAMMDD-HHMMSS/, fora do
 * Git, nome único, nunca sobrescrito). Formato em backup.ts do CLI; aqui ficam as regras compartilhadas:
 * onde os backups moram, como reconhecer o banco sem guardar a URL, e a exigência antes de gravar.
 */

export const BACKUP_PREFIX = 'backup-before-neon-';
/** Um backup vale para liberar gravações por este tempo (e só se o library.json ainda for o mesmo). */
export const BACKUP_VALID_MS = 12 * 60 * 60 * 1000;

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Identifica o banco sem guardar a URL: hash do endpoint (sem "-pooler") + banco. Pooler e direta = o mesmo. */
export const targetFingerprint = (url: string) => sha256(`perfumes-target:${describeTarget(url).identity}`);

export const backupsDir = () => path.join(config.dataDir, 'backups');
export const libraryFile = () => path.join(config.dataDir, 'library.json');

export interface BackupManifest {
  /** backup-before-neon (padrão) ou o --label usado. */
  kind: string;
  createdAt: string;
  gitCommit: string | null;
  target: { host: string; pooled: boolean; database: string; fingerprint: string } | null;
  libraryJson: { file: string; sha256: string; bytes: number };
  images: { file: string; count: number; missing: number };
  principalDb: { file: string | null; state: string; migrationsApplied: number; counts: Record<string, number> | null; sha256: string | null };
}

/** Backups já feitos (mais novo primeiro). */
export function listBackups(): { dir: string; manifest: BackupManifest }[] {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir())
    .filter((d) => d.startsWith(BACKUP_PREFIX) && existsSync(path.join(backupsDir(), d, 'manifest.json')))
    .map((d) => ({ dir: path.join(backupsDir(), d), manifest: JSON.parse(readFileSync(path.join(backupsDir(), d, 'manifest.json'), 'utf8')) as BackupManifest }))
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

/**
 * Pode gravar no banco principal? Só se existir um backup-before-neon deste MESMO banco, feito há menos de 12 h, do
 * library.json ATUAL (mesmo SHA-256). Devolve o motivo da recusa, ou null.
 */
export function backupRefusal(url: string, now = Date.now()): string | null {
  if (!existsSync(libraryFile())) return 'data/library.json não existe';
  const currentSha = sha256(readFileSync(libraryFile()));
  const fingerprint = targetFingerprint(url);
  const candidates = listBackups().filter((b) => b.manifest.target?.fingerprint === fingerprint);
  if (!candidates.length) return 'não há backup-before-neon deste banco. Rode `npm run db:backup` antes de qualquer operação que grave no principal';
  const fresh = candidates.find((b) => now - Date.parse(b.manifest.createdAt) < BACKUP_VALID_MS);
  if (!fresh) return 'o último backup-before-neon deste banco tem mais de 12 h. Rode `npm run db:backup` de novo';
  if (fresh.manifest.libraryJson.sha256 !== currentSha) return 'o library.json mudou depois do último backup-before-neon. Rode `npm run db:backup` de novo';
  return null;
}
