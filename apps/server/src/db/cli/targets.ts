import { readEnvFile } from '../../config';
import { describeTarget, sameEndpoint, sameTarget, testTargetRefusal } from '../targets';

/**
 * npm run db:targets   quais endereços de banco estão configurados e se o banco de TESTES é um ambiente separado.
 * Mostra só SIM/NÃO, host mascarado, pooler e nome do banco. Nunca a URL, usuário ou senha.
 * Sai com código 1 se o banco de testes não puder ser usado.
 */
const file = readEnvFile();
const get = (k: string) => (process.env[k]?.trim() || file[k] || '').trim();
const names = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'TEST_DATABASE_URL'] as const;
const urls = Object.fromEntries(names.map((k) => [k, get(k)])) as Record<(typeof names)[number], string>;

for (const k of names) {
  const u = urls[k];
  if (!u) {
    console.log(`${k} configurada: NÃO`);
    continue;
  }
  const t = describeTarget(u);
  console.log(`${k} configurada: SIM — ${t.kind === 'postgres' ? `${t.host} · ${t.pooled ? 'com pooler' : 'conexão direta'} · banco ${t.database}` : t.kind}`);
}

if (urls.DATABASE_URL && urls.DATABASE_URL_UNPOOLED) {
  const same = sameTarget(urls.DATABASE_URL, urls.DATABASE_URL_UNPOOLED);
  console.log(`DATABASE_URL e DATABASE_URL_UNPOOLED são o mesmo banco (pooler × direta): ${same ? 'SIM' : 'NÃO — confira: deveriam ser o mesmo banco'}`);
}

const refusal = testTargetRefusal(urls.TEST_DATABASE_URL, [urls.DATABASE_URL, urls.DATABASE_URL_UNPOOLED]);
console.log(`TEST_DATABASE_URL != DATABASE_URL: ${urls.TEST_DATABASE_URL && urls.TEST_DATABASE_URL !== urls.DATABASE_URL ? 'SIM' : 'NÃO'}`);
console.log(
  `Banco de testes em ambiente separado (outro endpoint/branch): ${
    refusal ? `NÃO — ${refusal}` : urls.DATABASE_URL && sameEndpoint(urls.TEST_DATABASE_URL, urls.DATABASE_URL) ? 'NÃO' : 'SIM'
  }`,
);
if (refusal) process.exit(1);
