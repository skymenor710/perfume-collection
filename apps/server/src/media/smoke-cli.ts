import { config, formatR2Diagnosis } from '../config';
import { boot, flag } from '../db/cli/common';
import { R2StorageProvider } from '../storage/r2';
import { formatSmokeReport, makeRedactor, planSmoke, runSmoke } from './smoke';

/**
 * npm run media:smoke                       Teste de ponta a ponta do R2 com UM objeto descartável:
 *                                           acesso → envio → leitura → SHA-256 → listagem do prefixo → URL pública → remoção.
 *                                           Termina em PASS ou FAIL, com a causa. Só toca em "healthcheck/<id>/probe.txt".
 * npm run media:diagnose                    (= media:smoke -- --diagnose) Só mostra QUAIS componentes do R2 faltam ou estão
 *                                           inválidos — nomes, nunca valores. Não usa a rede.
 *
 * Exige o R2 completo e válido; sem isso RECUSA (sem rede). Não exige MEDIA_BACKEND=r2: o smoke roda ANTES da virada,
 * com MEDIA_BACKEND=local. Saída: 0 = PASS · 1 = FAIL · 2 = R2 não configurado/inválido (recusado).
 */

if (flag('help')) {
  console.log('uso: npm run media:smoke [-- --diagnose]\n  (sem opções)  teste de ponta a ponta com um objeto descartável em healthcheck/\n  --diagnose    só mostra o que falta no R2, sem rede');
  process.exit(0);
}

boot();
const diagnosis = config.r2Diagnosis;

if (flag('diagnose')) {
  console.log(`MEDIA_BACKEND=${config.mediaBackend} · MEDIA_FALLBACK=${config.mediaFallback}`);
  for (const line of formatR2Diagnosis(diagnosis)) console.log(line);
  process.exit(diagnosis.state === 'complete' ? 0 : 2);
}

const plan = planSmoke(diagnosis);
if (!plan.run) {
  for (const line of plan.lines) console.log(line);
  process.exit(2);
}

const settings = diagnosis.settings!;
const redact = makeRedactor(settings);
const remote = new R2StorageProvider(settings, { timeoutMs: 15_000 });
const report = await runSmoke({ remote, fetchPublic: (url, init) => fetch(url, init), timeoutMs: 15_000 });
for (const line of formatSmokeReport(report, new URL(settings.publicBaseUrl).host)) console.log(redact(line));
process.exit(report.ok ? 0 : 1);
