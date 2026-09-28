import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Marcador da FONTE OFICIAL da coleção (data/storage-backend.json, fora do Git).
 *
 * Existe para impedir o rollback errado: depois que o Postgres vira a fonte oficial, o data/library.json fica PARADO
 * no estado do switch. Ligar STORAGE_BACKEND=json com esse arquivo antigo faria o app servir (e gravar em) uma coleção
 * desatualizada — em silêncio. Com o marcador dizendo "postgres", a partida com json é RECUSADA; a volta só acontece
 * pelo comando explícito `npm run db:rollback-json -- --confirm` (exporta do Postgres, confere, arquiva o library.json
 * atual e só então o substitui pela exportação, e vira o marcador para "json").
 */

export interface OfficialSource {
  official: 'postgres' | 'json';
  /** Desde quando esta é a fonte oficial. */
  since: string;
  /** Último momento em que o servidor confirmou (partida). */
  confirmedAt: string;
  /** SHA-256 do library.json quando o Postgres virou oficial (o arquivo parado). */
  libraryJsonSha256AtSwitch: string | null;
  /** Rollback: a exportação que virou o library.json. */
  rollback?: { at: string; exportFile: string; archivedLibraryJson: string; exportSha256: string };
}

export const officialSourceFile = () => path.join(config.dataDir, 'storage-backend.json');
const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export function readOfficialSource(): OfficialSource | null {
  try {
    return existsSync(officialSourceFile()) ? (JSON.parse(readFileSync(officialSourceFile(), 'utf8')) as OfficialSource) : null;
  } catch {
    return null;
  }
}

export function writeOfficialSource(value: OfficialSource) {
  const file = officialSourceFile();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Partida com postgres (banco aberto e em dia): registra/renova "postgres é a fonte oficial". */
export function markPostgresOfficial(now = new Date()) {
  const current = readOfficialSource();
  const libraryFile = path.join(config.dataDir, 'library.json');
  const librarySha = existsSync(libraryFile) ? sha256(readFileSync(libraryFile)) : null;
  writeOfficialSource({
    official: 'postgres',
    since: current?.official === 'postgres' ? current.since : now.toISOString(),
    confirmedAt: now.toISOString(),
    libraryJsonSha256AtSwitch: current?.official === 'postgres' ? current.libraryJsonSha256AtSwitch : librarySha,
  });
}

/** Motivo para RECUSAR a partida com STORAGE_BACKEND=json, ou null se pode. */
export function jsonStartRefusal(): string | null {
  const current = readOfficialSource();
  if (current?.official !== 'postgres') return null;
  return [
    `O Postgres é a fonte OFICIAL da coleção desde ${current.since}; o data/library.json está parado desde então.`,
    'Ligar STORAGE_BACKEND=json agora serviria uma coleção desatualizada. Nada foi alterado.',
    'Para voltar ao JSON com os dados de hoje, de forma explícita:',
    '  1. npm run db:rollback-json -- --confirm   (exporta do Postgres, confere, arquiva o library.json atual e o substitui)',
    '  2. só então STORAGE_BACKEND=json no .env.local e reiniciar.',
    'Para continuar no Postgres: STORAGE_BACKEND=postgres.',
  ].join('\n');
}
