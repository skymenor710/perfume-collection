import { config, formatR2Diagnosis } from '../config';
import { resolveImageFile } from '../db/checks';
import { boot, flag } from '../db/cli/common';
import { R2StorageProvider } from '../storage/r2';
import { readCollection } from './collection';
import { MediaMap } from './map';
import { makeRedactor } from './smoke';
import { formatVerifyReport, verifyMedia } from './verify';

/**
 * npm run media:verify                      Auditoria SOMENTE DE LEITURA: banco × media-map.json × arquivos locais × R2
 *                                           (× URL pública). Não grava nada — nem relatório em disco.
 *   --no-public                             não baixa também pela URL pública
 *   --json                                  saída em JSON (para conferência por máquina)
 *   --file=<library.json>                   usa um arquivo em vez da fonte oficial
 *
 * Estados: pre-r2 (R2 ainda não migrado) · partial · complete-unverified · verified · inconsistent.
 * Saída: 0 = pre-r2 ou verified · 1 = qualquer outro estado.
 * Sem o R2 configurado por completo, confere só o que dá sem rede (mapa, arquivos, banco) e diz que NÃO verificou os objetos.
 */

if (flag('help')) {
  console.log('uso: npm run media:verify [-- --no-public] [-- --json] [-- --file=<library.json>]\n  auditoria somente de leitura: banco × mapa × arquivos locais × R2 × URL pública');
  process.exit(0);
}

boot();
const { library, expected } = await readCollection();
const diagnosis = config.r2Diagnosis;
const settings = diagnosis.settings;
const remote = settings ? new R2StorageProvider(settings, { timeoutMs: 15_000 }) : null;

const report = await verifyMedia({
  map: new MediaMap(config.mediaMapFile),
  library,
  expectedSha: expected,
  resolveLocal: resolveImageFile,
  remote,
  fetchPublic: remote && !flag('no-public') ? (url, init) => fetch(url, init) : null,
});

const redact = settings ? makeRedactor(settings) : (text: string) => text;
if (flag('json')) console.log(redact(JSON.stringify(report, null, 2)));
else {
  for (const line of formatVerifyReport(report)) console.log(redact(line));
  if (!settings && diagnosis.state !== 'absent') for (const line of formatR2Diagnosis(diagnosis)) console.log(line);
}
process.exitCode = report.ok ? 0 : 1;
