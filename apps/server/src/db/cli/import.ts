import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { baselineChecks, readBaseline, resolveImageFile } from '../checks';
import { redactDbError } from '../client';
import { formatDifferences } from '../compare';
import { importLibrary, validateLibrary, type ImportReport } from '../importer';
import { migrationStatus } from '../status';
import { BASELINE_FILE, boot, connect, describeTarget, die, flag, MIGRATION_ID, option, requireBackupBeforeWrite, table, targetUrl, writeReport } from './common';

/**
 * npm run db:import                       importa data/library.json (valida → transação → verifica → COMMIT)
 * npm run db:import -- --dry-run          faz tudo e desfaz no fim (ensaio)
 * npm run db:import -- --allow-update     permite sobrescrever registros do banco que estejam diferentes do JSON
 * npm run db:import -- --file=<caminho>   outro arquivo no formato do library.json
 * npm run db:import -- --no-baseline      sem as checagens do baseline (bancos de teste)
 */
boot();
const file = path.resolve(config.root, option('file', path.join(path.relative(config.root, config.dataDir), 'library.json')));
if (!existsSync(file)) die(`Arquivo não encontrado: ${file}`);
const bytes = readFileSync(file);
const raw = JSON.parse(bytes.toString('utf8')) as unknown;

console.log(`Migração ${MIGRATION_ID}`);
console.log(`Origem: ${path.relative(config.root, file)} (sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}…)`);

const validation = validateLibrary(raw, resolveImageFile);
console.log(`Validação: ${validation.counts.users} usuário(s), ${validation.counts.products} produtos, ${validation.counts.variants} versões, ${validation.counts.images} imagens, ${validation.counts.entries} entradas, ${validation.counts.imageFiles} arquivos de imagem conferidos`);
for (const w of validation.warnings) console.log(`  aviso: ${w}`);
if (!validation.ok) {
  console.log(`Relatório: ${writeReport('import-falhou-validacao', { validation })}`);
  die(`VALIDAÇÃO FALHOU — o banco não foi tocado:\n  ${validation.problems.join('\n  ')}`);
}

const baselineFile = path.join(config.root, BASELINE_FILE);
const useBaseline = !flag('no-baseline');
if (useBaseline && !existsSync(baselineFile)) die(`Baseline não encontrado (${BASELINE_FILE}). Rode com --no-baseline só em banco de teste.`);
const baseline = useBaseline ? readBaseline(baselineFile) : null;

const url = targetUrl('data');
const handle = await connect(url);
let report: ImportReport;
try {
  console.log(`Destino: ${describeTarget(url)}`);
  const status = await migrationStatus(handle.db);
  if (!status.upToDate) die(`O banco não tem todas as migrations (faltam: ${status.pending.join(', ')}). Rode npm run db:migrate antes.`);
  // Importação REAL no principal só com backup-before-neon recente (o ensaio desfaz tudo e não precisa).
  if (!flag('dry-run')) requireBackupBeforeWrite(url);
  report = await importLibrary(handle.db, validation, {
    dryRun: flag('dry-run'),
    allowUpdate: flag('allow-update'),
    checks: baseline ? (lib) => baselineChecks(baseline, lib) : undefined,
  });
} catch (error) {
  const failed = (error as { report?: ImportReport }).report;
  if (failed) console.log(`Relatório: ${writeReport('import-falhou', failed)}`);
  die(`IMPORTAÇÃO FALHOU — ROLLBACK, nada foi gravado: ${redactDbError(error, url)}`);
} finally {
  await handle.close();
}

console.log('');
console.log(table(Object.entries(report.tables).map(([name, t]) => ({ tabela: name, json: t.source, inseridos: t.inserted, atualizados: t.updated, iguais: t.unchanged, 'só no banco': t.onlyInDb }))));
console.log('');
if (report.conflicts.length) console.log(`Diferenças encontradas (${report.conflicts.length}):\n${formatDifferences(report.conflicts)}`);
if (report.verification.length) console.log(`Verificação JSON × banco (${report.verification.length}):\n${formatDifferences(report.verification)}`);
if (report.checks.length) console.log(`Checagens do baseline:\n  ${report.checks.join('\n  ')}`);
console.log(`Relatório: ${writeReport(report.dryRun ? 'import-ensaio' : 'import', report)}`);
if (!report.ok) die(`PAROU na etapa "${report.stage}": ${report.message}`);
console.log(report.message);
if (baseline) console.log(`Baseline (${baseline.savedAt}): ${baseline.perfumes.length} perfumes campo a campo, ${baseline.counts.images} imagens por SHA-256 e Mykonos Reflection 50 ml — ok.`);
