import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeLibrary } from '@perfumes/core/library';
import type { Perfume } from '@perfumes/core/perfume';
import { config } from '../../config';
import { PostgresLibraryRepository } from '../../repositories/postgres';
import { libraryViews } from '../../repositories/rules';
import { baselineChecks, readBaseline } from '../checks';
import { redactDbError } from '../client';
import { diffLibraries, diffViews, formatDifferences, type Difference } from '../compare';
import { loadLibrary, sortedLibrary } from '../snapshot';
import { migrationStatus } from '../status';
import { API_SNAPSHOT_FILE, BASELINE_FILE, boot, connect, describeTarget, die, option, table, writeReport, targetUrl } from './common';

/**
 * npm run db:verify                     compara o banco com data/library.json, com o baseline e com a API de antes
 * npm run db:verify -- --against=<arq>  compara com outro arquivo no formato do library.json (ex.: uma exportação)
 *
 * Só lê. Sai com código 1 se houver QUALQUER diferença, listando campo, valor antigo e valor novo.
 */
boot();
const against = path.resolve(config.root, option('against', path.join(path.relative(config.root, config.dataDir), 'library.json')));
if (!existsSync(against)) die(`Arquivo não encontrado: ${against}`);
const jsonLib = sortedLibrary(sanitizeLibrary(JSON.parse(readFileSync(against, 'utf8'))).library);

const url = targetUrl('data');
const handle = await connect(url);
const sections: { nome: string; resultado: string; diferencas: number }[] = [];
const details: Record<string, Difference[] | string[]> = {};
let apiBytesEqual = false;
let apiSnapshotBytesEqual = false;
let revisions: { json: unknown; postgres: number } | null = null;
try {
  console.log(`Banco: ${describeTarget(url)} · comparado com ${path.relative(config.root, against)}`);
  const status = await migrationStatus(handle.db);
  sections.push({ nome: 'migrations', resultado: status.upToDate ? `em dia (${status.expected.join(', ')})` : `faltam ${status.pending.join(', ')}`, diferencas: status.pending.length });

  const dbLib = await loadLibrary(handle.db);
  const counts = (l: typeof dbLib) => ({
    usuarios: l.users.length,
    produtos: l.products.length,
    versoes: l.products.reduce((n, p) => n + p.variants.length, 0),
    imagens: l.products.reduce((n, p) => n + p.images.length, 0),
    entradas: l.entries.length,
  });
  console.log('');
  console.log(table([{ fonte: 'JSON', ...counts(jsonLib) }, { fonte: 'Postgres', ...counts(dbLib) }]));
  console.log('');

  const libDiff = diffLibraries(jsonLib, dbLib);
  details.biblioteca = libDiff;
  sections.push({ nome: 'JSON × Postgres (todos os campos)', resultado: libDiff.length ? 'DIFERENTE' : 'idêntico', diferencas: libDiff.length });

  const baselineFile = path.join(config.root, BASELINE_FILE);
  if (existsSync(baselineFile)) {
    const problems = baselineChecks(readBaseline(baselineFile), dbLib);
    details.baseline = problems;
    sections.push({ nome: 'baseline (15 perfumes, 32 imagens SHA-256, Reflection 50 ml)', resultado: problems.length ? 'FALHOU' : 'ok', diferencas: problems.length });
  }

  // API: a lista que /api/perfumes entrega, montada pelas duas fontes com as MESMAS regras.
  const repo = await PostgresLibraryRepository.open(handle.db, config.ownerId);
  const pgViews = await repo.list();
  const jsonViews = libraryViews(jsonLib, repo.ownerId);
  const apiDiff = diffViews(jsonViews, pgViews);
  apiBytesEqual = JSON.stringify(jsonViews) === JSON.stringify(pgViews);
  details.api = apiDiff;
  sections.push({ nome: 'API /api/perfumes: JSON × Postgres', resultado: apiDiff.length ? 'DIFERENTE' : apiBytesEqual ? 'idêntica byte a byte' : 'equivalente (ordem de chaves difere)', diferencas: apiDiff.length });

  const snapshotFile = path.join(config.root, API_SNAPSHOT_FILE);
  if (existsSync(snapshotFile)) {
    const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as { revision: unknown; perfumes: Perfume[] };
    const snapDiff = diffViews(snapshot.perfumes, pgViews);
    apiSnapshotBytesEqual = JSON.stringify(snapshot.perfumes) === JSON.stringify(pgViews);
    details.apiAntes = snapDiff;
    revisions = { json: snapshot.revision, postgres: await repo.revision() };
    sections.push({ nome: 'API capturada antes da migração × Postgres', resultado: snapDiff.length ? 'DIFERENTE' : apiSnapshotBytesEqual ? 'idêntica byte a byte' : 'equivalente', diferencas: snapDiff.length });
  }
} catch (error) {
  die(`Verificação não completou: ${redactDbError(error, url)}`);
} finally {
  await handle.close();
}

console.log(table(sections));
console.log('');
for (const [name, list] of Object.entries(details)) {
  if (!list.length) continue;
  console.log(`${name} (${list.length}):`);
  console.log(typeof list[0] === 'string' ? `  ${(list as string[]).join('\n  ')}` : formatDifferences(list as Difference[]));
}
if (revisions) {
  console.log(`Campo "revision" da resposta: JSON ${String(revisions.json)} → Postgres ${revisions.postgres}. Não é dado da coleção: é o contador de`);
  console.log('sincronização (o JSON conta desde que o servidor ligou; o Postgres guarda no banco). A interface só usa para saber quando recarregar.');
}
const total = sections.reduce((n, s) => n + s.diferencas, 0);
console.log(`Relatório: ${writeReport('verify', { against: path.relative(config.root, against), sections, details, revisions, apiBytesEqual, apiSnapshotBytesEqual })}`);
if (total) die(`VERIFICAÇÃO FALHOU: ${total} diferença(s).`);
console.log('Verificação OK: nenhuma diferença.');
