import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, formatR2Diagnosis } from '../config';
import { resolveImageFile } from '../db/checks';
import { boot, die, flag, table } from '../db/cli/common';
import { StorageUnavailableError } from '../storage/types';
import { R2StorageProvider } from '../storage/r2';
import { readCollection } from './collection';
import { MediaMap } from './map';
import { dryRun, inventory, migrateObjects, refLocations } from './migrate';

/**
 * npm run media:migrate                     DRY-RUN (padrão): inventário, SHA-256, chaves, o que subiria, duplicatas
 *                                           evitadas, faltantes e divergências. Só LÊ: a coleção (Postgres em
 *                                           transação de leitura, ou library.json), os arquivos e — se o R2 estiver
 *                                           configurado — a existência dos objetos. Não sobe nada.
 * npm run media:migrate -- --confirm        Sobe e PROVA cada objeto (SHA-256 de volta), grava o mapa. Exige R2
 *                                           configurado. NÃO altera nenhuma referência do banco (isso é a virada, FASE 3.2).
 *   --file=<library.json>                   usa um arquivo (ex.: um export) em vez da fonte oficial.
 *
 * Com o R2 configurado, antes de qualquer consulta ou envio o comando prova o acesso ao bucket (uma listagem mínima):
 * bucket errado, credencial recusada ou endereço que não é S3 aparecem aqui, com a causa — e não como "enviar" em tudo.
 * Sugestão: rode `npm run media:smoke` antes da primeira migração real.
 */

boot();
const confirm = flag('confirm');

function saveReport(step: string, data: unknown): string {
  const dir = path.join(config.dataDir, 'migrations', 'media');
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${step}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  return path.relative(config.root, target);
}

const { library, expected, source } = await readCollection();
const items = inventory(
  refLocations(library).map((l) => l.ref),
  resolveImageFile,
  expected,
);
const map = new MediaMap(config.mediaMapFile);
const r2 = config.r2;
const remote = r2 ? new R2StorageProvider(r2) : null;
const diagnosis = config.r2Diagnosis;

console.log(`Coleção: ${source} · fotos: ${config.mediaBackend}${r2 ? ' · R2 configurado' : ' · R2 NÃO configurado'}`);
if (!r2 && diagnosis.state !== 'absent') for (const line of formatR2Diagnosis(diagnosis)) console.log(line);

if (remote) {
  try {
    await remote.checkAccess();
    console.log('Acesso ao bucket: ok (endereço, credenciais e bucket aceitos).');
  } catch (error) {
    die(`Acesso ao R2 recusado — nada foi consultado nem enviado: ${error instanceof StorageUnavailableError ? error.detail : 'erro inesperado'}.\nRode \`npm run media:smoke\` para o diagnóstico completo.`);
  }
}

if (!confirm) {
  const report = await dryRun(items, map.read(), remote);
  const counts = new Map<string, number>();
  for (const f of report.files) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  console.log('');
  console.log(table([...counts.entries()].map(([estado, n]) => ({ estado, referências: n }))));
  console.log('');
  console.log(`DRY-RUN — nada foi enviado. Referências: ${report.total} (${report.localRefs} locais) · objetos únicos: ${report.uniqueObjects} · a criar: ${report.keysToCreate.length} · já validados: ${report.alreadyValidated.length} · já no destino sem prova: ${report.existingRemote.length} · duplicatas evitadas: ${report.duplicatesAvoided}`);
  console.log(`Referências que mudariam na virada: ${report.refsToChange.length} · faltando: ${report.missing.length} · divergentes: ${report.divergences.length}${report.remoteChecked ? ` · erros ao consultar o destino: ${report.remoteErrors.length}` : ' · destino não consultado (R2 não configurado)'}`);
  console.log(`Relatório: ${saveReport('dry-run', report)}`);
  if (report.missing.length || report.divergences.length) die('Há fotos faltando ou divergentes: resolva antes de qualquer upload.');
  process.exit(0);
}

if (!remote) die(`--confirm precisa do R2 configurado por completo (R2_* no .env.local — modelo em .env.example). Nada foi enviado.${diagnosis.state === 'absent' ? '' : ' Veja o diagnóstico acima.'}`);
const blocking = items.filter((i) => i.kind === 'local' && i.problem);
if (blocking.length) die(`Upload recusado — ${blocking.length} foto(s) com problema (${blocking.map((b) => `${b.ref}: ${b.problem}`).join('; ')}). Nada foi enviado.`);
const report = await migrateObjects(items, { remote, map });
console.log(`Enviados e provados: ${report.uploaded.length} · já estavam provados: ${report.skipped.length} · falharam: ${report.failed.length}`);
for (const f of report.failed) console.log(`  FALHOU ${f.key} (${f.refs.join(', ')}): ${f.reason}`);
console.log('Nenhuma referência do banco foi alterada (a virada é outra etapa).');
console.log(`Relatório: ${saveReport('upload', report)}`);
console.log('Próximo passo: `npm run media:verify` (baixa cada objeto e confere SHA-256, mapa e URL pública).');
process.exit(report.ok ? 0 : 1);
