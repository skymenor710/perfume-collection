import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeLibrary } from '@perfumes/core/library';
import { config } from '../../config';
import { redactDbError } from '../client';
import { diffLibraries, formatDifferences } from '../compare';
import { loadLibrary, sortedLibrary } from '../snapshot';
import { boot, connect, describeTarget, die, targetUrl } from './common';

/**
 * npm run db:export   banco → arquivo no formato do data/library.json (data/exports/, nome único, nunca sobrescreve).
 *
 * É o caminho de VOLTA: copiar a exportação para data/library.json e usar STORAGE_BACKEND=json devolve o app ao
 * arquivo com os dados de agora. A exportação é relida e comparada com o banco antes de dizer que deu certo.
 */
boot();
const url = targetUrl('data');
const handle = await connect(url);
try {
  const library = await loadLibrary(handle.db);
  const dir = path.join(config.dataDir, 'exports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `library.postgres-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const text = `${JSON.stringify(library, null, 2)}\n`;
  writeFileSync(file, text, { flag: 'wx' });
  const reread = sanitizeLibrary(JSON.parse(text));
  const diffs = diffLibraries(sortedLibrary(reread.library), library);
  if (reread.dropped || diffs.length) die(`A exportação não relê igual ao banco (${reread.dropped} descartadas, ${diffs.length} diferenças):\n${formatDifferences(diffs)}`);
  console.log(`Banco: ${describeTarget(url)}`);
  console.log(`Exportado: ${path.relative(config.root, file)} — ${library.users.length} usuário(s), ${library.products.length} produtos, ${library.entries.length} entradas; relido e idêntico ao banco.`);
} catch (error) {
  die(`Exportação falhou: ${redactDbError(error, url)}`);
} finally {
  await handle.close();
}
