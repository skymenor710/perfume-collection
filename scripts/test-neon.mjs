// npm run test:neon — a bateria de banco (constraints, importação, rollback, concorrência A–F, pooler, repositório,
// equivalência da API com a coleção real) contra o BRANCH DE TESTES do Neon, pelo pooler, um arquivo por vez.
// Nunca toca no banco principal: db:targets confere a separação antes, e o helper confere de novo.
// No fim, limpa os dados de teste (o schema fica em dia e vazio).
import { spawnSync } from 'node:child_process';

const tsx = ['node_modules/tsx/dist/cli.mjs'];
const run = (args, env = {}) => spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

if (run([...tsx, 'apps/server/src/db/cli/targets.ts']) !== 0) process.exit(1);
if (run([...tsx, 'scripts/neon-test-db.ts', 'reset']) !== 0) process.exit(1);

const status = run(['node_modules/vitest/vitest.mjs', 'run', 'tests/db.test.ts', 'tests/api-equivalence.test.ts', '--no-file-parallelism', '--testTimeout=180000', '--hookTimeout=240000'], {
  PERFUMES_TEST_NEON: '1',
  LOG_LEVEL: 'silent',
});

console.log('\nLimpando os dados de teste do branch…');
const clean = run([...tsx, 'scripts/neon-test-db.ts', 'clean']);
process.exit(status || clean);
