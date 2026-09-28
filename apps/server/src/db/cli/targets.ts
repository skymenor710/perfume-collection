import { readEnvFile } from '../../config';
import { checkTestTarget, describeTarget, sameEndpoint, sameTarget } from '../targets';

/**
 * npm run db:targets   quais endereços de banco estão configurados e se o banco de TESTES pode receber operações
 * destrutivas (é outro ambiente, passa pelo pooler e, se NEON_TEST_DATABASE_NAME existir, tem exatamente esse nome).
 * Mostra só SIM/NÃO, host mascarado, pooler e nome do banco. Nunca a URL, usuário ou senha.
 * Sai com código 1 se o banco de testes não puder ser usado — nada destrutivo roda depois disso.
 */
const file = readEnvFile();
const get = (k: string) => (process.env[k]?.trim() || file[k] || '').trim();
const names = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'TEST_DATABASE_URL'] as const;

for (const k of names) {
  const u = get(k);
  if (!u) {
    console.log(`${k} configurada: NÃO`);
    continue;
  }
  const t = describeTarget(u);
  console.log(`${k} configurada: SIM — ${t.kind === 'postgres' ? `${t.host} · ${t.pooled ? 'com pooler' : 'conexão direta'} · banco ${t.database}` : t.kind}`);
}
console.log(`NEON_TEST_DATABASE_NAME: ${get('NEON_TEST_DATABASE_NAME') ? `"${get('NEON_TEST_DATABASE_NAME')}"` : 'não definida (proteção por nome desligada)'}`);

if (get('DATABASE_URL') && get('DATABASE_URL_UNPOOLED')) {
  const same = sameTarget(get('DATABASE_URL'), get('DATABASE_URL_UNPOOLED'));
  console.log(`DATABASE_URL e DATABASE_URL_UNPOOLED são o mesmo banco (pooler × direta): ${same ? 'SIM' : 'NÃO — confira: deveriam ser o mesmo banco'}`);
  if (describeTarget(get('DATABASE_URL')).pooled === false) console.log('Aviso: DATABASE_URL não passa pelo pooler (o app deveria usar a URL com "-pooler").');
}

const check = checkTestTarget(get, { requirePooler: true });
const test = get('TEST_DATABASE_URL');
console.log(`TEST_DATABASE_URL != DATABASE_URL: ${test && test !== get('DATABASE_URL') ? 'SIM' : 'NÃO'}`);
console.log(`Banco de testes em ambiente separado (outro endpoint/branch): ${test && get('DATABASE_URL') && !sameEndpoint(test, get('DATABASE_URL')) && !check.refusals.some((r) => /MESMO/.test(r)) ? 'SIM' : 'NÃO'}`);
console.log(`Banco de testes pelo pooler: ${check.test?.pooled ? 'SIM' : 'NÃO'}`);
if (check.expectedDatabase) console.log(`Nome do banco de testes confere com NEON_TEST_DATABASE_NAME: ${check.test?.database === check.expectedDatabase ? 'SIM' : 'NÃO'}`);
if (!check.ok) {
  console.log(`\nRECUSADO — nenhuma operação destrutiva será executada:\n  ${check.refusals.join('\n  ')}`);
  process.exit(1);
}
console.log('\nBanco de testes LIBERADO para test:neon, smoke --database=test e --target=test.');
