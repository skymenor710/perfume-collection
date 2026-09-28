import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeLibrary, type Library } from '@perfumes/core/library';
import type { DbHandle } from '../apps/server/src/db/client';
import { fixtureLibrary, freshDb, imageFolder } from './helpers/db';

/**
 * Proteção contra rollback errado (FASE 2.5.1): com o Postgres oficial, a partida com STORAGE_BACKEND=json é recusada;
 * a volta só acontece pelo rollback explícito, que exporta, confere, ARQUIVA o library.json e só então o substitui.
 * Tudo numa pasta de dados temporária — o data/ real nunca é tocado.
 */

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-rollback-'));
const libraryFile = path.join(dataDir, 'library.json');
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
let handle: DbHandle;
let lib: Library;
const saved = { ...process.env };

beforeAll(async () => {
  process.env.PERFUMES_DATA_DIR = dataDir;
  process.env.PERFUMES_ACCESS_CODE = 'TESTE1';
  const { reloadConfig } = await import('../apps/server/src/config');
  reloadConfig();
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  lib = fixtureLibrary();
  // O library.json "parado": uma versão ANTIGA (sem o último perfume), como ficaria depois do switch.
  const old = { ...lib, products: lib.products.slice(0, -1), entries: lib.entries.slice(0, -1) };
  writeFileSync(libraryFile, JSON.stringify(old, null, 2));
  handle = await freshDb();
  const { importLibrary, validateLibrary } = await import('../apps/server/src/db/importer');
  expect((await importLibrary(handle.db, validateLibrary(JSON.parse(JSON.stringify(lib)), imageFolder(lib)))).ok).toBe(true);
});

afterAll(async () => {
  await handle.close();
  process.env = saved;
  const { reloadConfig } = await import('../apps/server/src/config');
  reloadConfig();
});

describe('fonte oficial e rollback explícito', () => {
  it('sem marcador: JSON pode subir (instalação que nunca foi para o Postgres)', async () => {
    const { jsonStartRefusal } = await import('../apps/server/src/repositories/official-source');
    expect(jsonStartRefusal()).toBeNull();
  });

  it('Postgres oficial: marcador registrado com o SHA-256 do library.json parado; "since" não muda nas próximas partidas', async () => {
    const { markPostgresOfficial, readOfficialSource } = await import('../apps/server/src/repositories/official-source');
    markPostgresOfficial(new Date('2026-09-28T19:00:00.000Z'));
    markPostgresOfficial(new Date('2026-09-29T08:00:00.000Z'));
    const m = readOfficialSource()!;
    expect(m).toMatchObject({ official: 'postgres', since: '2026-09-28T19:00:00.000Z', confirmedAt: '2026-09-29T08:00:00.000Z', libraryJsonSha256AtSwitch: sha(libraryFile) });
  });

  it('STORAGE_BACKEND=json com o Postgres oficial: partida RECUSADA e library.json intacto (nem regravado)', async () => {
    const before = { sha: sha(libraryFile), mtime: statSync(libraryFile).mtimeMs };
    process.env.STORAGE_BACKEND = 'json';
    const { reloadConfig } = await import('../apps/server/src/config');
    reloadConfig();
    const { openLibraryRepository, StartupError } = await import('../apps/server/src/repositories');
    await expect(openLibraryRepository()).rejects.toBeInstanceOf(StartupError);
    await expect(openLibraryRepository()).rejects.toThrow(/db:rollback-json -- --confirm/);
    expect({ sha: sha(libraryFile), mtime: statSync(libraryFile).mtimeMs }).toEqual(before);
  });

  it('rollback SEM --confirm: só exporta e confere; library.json e marcador intactos', async () => {
    const { rollbackToJson } = await import('../apps/server/src/db/rollback-json');
    const { readOfficialSource } = await import('../apps/server/src/repositories/official-source');
    const before = sha(libraryFile);
    const report = await rollbackToJson(handle.db, dataDir, { confirm: false, now: new Date('2026-09-29T09:00:00.000Z') });
    expect(report.confirmed).toBe(false);
    expect(existsSync(report.exportFile)).toBe(true);
    expect(sha(libraryFile)).toBe(before);
    expect(readOfficialSource()?.official).toBe('postgres');
  });

  it('rollback COM --confirm: arquiva o library.json antigo, põe a exportação conferida no lugar e vira o marcador', async () => {
    const { rollbackToJson } = await import('../apps/server/src/db/rollback-json');
    const { readOfficialSource, jsonStartRefusal } = await import('../apps/server/src/repositories/official-source');
    const { loadLibrary, sortedLibrary } = await import('../apps/server/src/db/snapshot');
    const { diffLibraries } = await import('../apps/server/src/db/compare');
    const oldContent = readFileSync(libraryFile, 'utf8');
    const report = await rollbackToJson(handle.db, dataDir, { confirm: true, now: new Date('2026-09-29T10:00:00.000Z') });
    expect(report.confirmed).toBe(true);
    // O antigo não foi perdido: está arquivado, byte a byte.
    expect(readFileSync(report.archivedLibraryJson!, 'utf8')).toBe(oldContent);
    // O novo library.json é o Postgres de agora (inclusive o perfume que o antigo não tinha).
    const now = sanitizeLibrary(JSON.parse(readFileSync(libraryFile, 'utf8')));
    expect(now.dropped).toBe(0);
    expect(diffLibraries(sortedLibrary(now.library), await loadLibrary(handle.db))).toEqual([]);
    expect(now.library.entries).toHaveLength(lib.entries.length);
    expect(readOfficialSource()).toMatchObject({ official: 'json', rollback: { exportSha256: sha(report.exportFile) } });
    expect(jsonStartRefusal()).toBeNull();
  });

  it('o rollback nunca sobrescreve arquivo antigo de histórico ou de exportação', async () => {
    const { rollbackToJson } = await import('../apps/server/src/db/rollback-json');
    await expect(rollbackToJson(handle.db, dataDir, { confirm: true, now: new Date('2026-09-29T10:00:00.000Z') })).rejects.toThrow(/EEXIST/);
  });
});
