import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeLibrary } from '@perfumes/core/library';
import { readOfficialSource, writeOfficialSource } from '../repositories/official-source';
import type { Db } from './client';
import { diffLibraries, formatDifferences } from './compare';
import { loadLibrary, sortedLibrary } from './snapshot';

/**
 * Volta EXPLÍCITA do Postgres para o JSON, sem perder nada (nunca automático; o CLI exige --confirm):
 *
 *   1. exporta o Postgres de AGORA (data/exports/library.postgres-rollback-….json) e confere a exportação com o banco;
 *   2. ARQUIVA o data/library.json atual em data/history/ (cópia conferida pelo SHA-256; nada é apagado);
 *   3. só então põe a exportação no lugar do data/library.json (arquivo temporário + rename) e confere de novo;
 *   4. vira o marcador de fonte oficial para "json".
 *
 * Não mexe no .env.local: trocar STORAGE_BACKEND continua sendo um passo separado e consciente.
 * Qualquer conferência que falhe PARA antes de tocar no library.json.
 */

export interface RollbackReport {
  confirmed: boolean;
  exportFile: string;
  archivedLibraryJson: string | null;
  counts: { users: number; products: number; entries: number };
  steps: string[];
}

const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

export class RollbackError extends Error {}

export async function rollbackToJson(db: Db, dataDir: string, options: { confirm: boolean; now?: Date }): Promise<RollbackReport> {
  const now = options.now ?? new Date();
  const steps: string[] = [];
  const libraryFile = path.join(dataDir, 'library.json');

  // 1. Exportação do Postgres de agora, relida e conferida.
  const library = await loadLibrary(db);
  const text = `${JSON.stringify(library, null, 2)}\n`;
  mkdirSync(path.join(dataDir, 'exports'), { recursive: true });
  const exportFile = path.join(dataDir, 'exports', `library.postgres-rollback-${stamp(now)}.json`);
  writeFileSync(exportFile, text, { flag: 'wx' });
  const reread = sanitizeLibrary(JSON.parse(readFileSync(exportFile, 'utf8')));
  const exportDiffs = diffLibraries(sortedLibrary(reread.library), library);
  if (reread.dropped || exportDiffs.length) throw new RollbackError(`A exportação não relê igual ao banco — library.json NÃO foi tocado:\n${formatDifferences(exportDiffs)}`);
  steps.push(`exportação conferida: ${path.relative(dataDir, exportFile)}`);
  const counts = { users: library.users.length, products: library.products.length, entries: library.entries.length };

  if (!options.confirm) {
    steps.push('ENSAIO: sem --confirm, nada mais foi feito (library.json e marcador intactos).');
    return { confirmed: false, exportFile, archivedLibraryJson: null, counts, steps };
  }

  // 2. Arquiva o library.json atual (cópia conferida). Nunca sobrescreve um arquivo antigo.
  let archived: string | null = null;
  if (existsSync(libraryFile)) {
    mkdirSync(path.join(dataDir, 'history'), { recursive: true });
    archived = path.join(dataDir, 'history', `library.before-rollback-${stamp(now)}.json`);
    copyFileSync(libraryFile, archived);
    if (sha256(readFileSync(archived)) !== sha256(readFileSync(libraryFile))) throw new RollbackError('A cópia de arquivo do library.json não confere — library.json NÃO foi tocado.');
    steps.push(`library.json anterior arquivado: ${path.relative(dataDir, archived)}`);
  }

  // 3. A exportação vira o library.json (atômico) e é conferida de novo.
  const tmp = `${libraryFile}.rollback-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, libraryFile);
  const placed = readFileSync(libraryFile);
  const check = sanitizeLibrary(JSON.parse(placed.toString('utf8')));
  const diffs = diffLibraries(sortedLibrary(check.library), library);
  if (sha256(placed) !== sha256(text) || check.dropped || diffs.length) throw new RollbackError(`O novo library.json não confere com o banco (o anterior está em ${archived}).`);
  steps.push('library.json = exportação do Postgres (conferido)');

  // 4. Marcador: a fonte oficial volta a ser o JSON.
  const previous = readOfficialSource();
  writeOfficialSource({
    official: 'json',
    since: now.toISOString(),
    confirmedAt: now.toISOString(),
    libraryJsonSha256AtSwitch: previous?.libraryJsonSha256AtSwitch ?? null,
    rollback: { at: now.toISOString(), exportFile: path.relative(dataDir, exportFile), archivedLibraryJson: archived ? path.relative(dataDir, archived) : '', exportSha256: sha256(text) },
  });
  steps.push('marcador de fonte oficial = json');
  return { confirmed: true, exportFile, archivedLibraryJson: archived, counts, steps };
}
