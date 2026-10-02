import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeLibrary, type Library } from '@perfumes/core/library';
import { config } from '../config';
import { redactDbError } from '../db/client';
import { connect, describeTarget, die, option } from '../db/cli/common';
import { productImages } from '../db/schema';
import { loadLibrary } from '../db/snapshot';

/**
 * A coleção vista pelos comandos `media:*` — SOMENTE LEITURA. (Só usada pelas CLIs; nada do servidor importa isto.)
 *   --file=<library.json>   um arquivo (ex.: um export) em vez da fonte oficial;
 *   sem --file, STORAGE_BACKEND=json   data/library.json;
 *   sem --file, STORAGE_BACKEND=postgres   SELECT no banco oficial (nunca grava), com o SHA-256 que o banco registrou de cada foto.
 */
export interface Collection {
  library: Library;
  /** ref → SHA-256 registrado no banco (vazio quando a fonte é um arquivo). */
  expected: Map<string, string | null>;
  source: string;
}

export async function readCollection(): Promise<Collection> {
  const file = option('file', '');
  if (file) {
    const library = sanitizeLibrary(JSON.parse(readFileSync(path.resolve(config.root, file), 'utf8'))).library;
    return { library, expected: new Map(), source: path.relative(config.root, path.resolve(config.root, file)) };
  }
  if (config.storageBackend !== 'postgres') {
    const library = sanitizeLibrary(JSON.parse(readFileSync(path.join(config.dataDir, 'library.json'), 'utf8'))).library;
    return { library, expected: new Map(), source: 'data/library.json' };
  }
  const handle = await connect(config.databaseUrl);
  try {
    // Só SELECT (como o db:export): a coleção e o SHA-256 que o banco registrou de cada foto principal (acusa
    // arquivo trocado). Pelo pool, não numa transação: o loadLibrary faz consultas em paralelo.
    const library = await loadLibrary(handle.db);
    const rows = await handle.db.select({ ref: productImages.ref, sha: productImages.sha256 }).from(productImages);
    return { library, expected: new Map(rows.map((r) => [r.ref, r.sha])), source: describeTarget(config.databaseUrl) };
  } catch (error) {
    die(`Não consegui ler a coleção (nada foi gravado): ${redactDbError(error, config.databaseUrl)}`);
  } finally {
    await handle.close();
  }
}
