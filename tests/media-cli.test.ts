import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtureLibrary } from './helpers/db';

/**
 * FASE 3.1 (hardening sem credenciais) — as CLIs `media:smoke`, `media:diagnose`, `media:verify` e `media:migrate` rodando
 * DE VERDADE (processo filho, tsx), mas só nos caminhos que não usam a rede:
 *   - `PERFUMES_ENV_FILE` aponta para um arquivo TEMPORÁRIO com valores fictícios: o .env.local real nunca é aberto;
 *   - a coleção vem de `--file=` e STORAGE_BACKEND=json: o Neon nunca é tocado;
 *   - nunca se roda um cenário com R2 completo que chegaria a fazer o smoke/migração de verdade (só recusas e diagnóstico).
 */
vi.setConfig({ testTimeout: 120_000 });

const ACC = '0123456789abcdef0123456789abcdef';
const R2_FULL = { R2_ACCOUNT_ID: ACC, R2_ACCESS_KEY_ID: 'chave-ficticia-abc', R2_SECRET_ACCESS_KEY: 'segredo-ficticio-xyz', R2_BUCKET: 'bucket-ficticio-teste', R2_PUBLIC_BASE_URL: 'https://img.ficticio.test' };
const VALUES = ['chave-ficticia-abc', 'segredo-ficticio-xyz', 'bucket-ficticio-teste', 'img.ficticio.test', ACC];

const realEnv = path.resolve('.env.local');
const realEnvStamp = () => (existsSync(realEnv) ? `${statSync(realEnv).mtimeMs}|${statSync(realEnv).size}` : 'ausente');
let envStampBefore = '';
beforeAll(() => {
  envStampBefore = realEnvStamp();
});
afterAll(() => {
  // O .env.local real não foi aberto para escrita, nem recriado: mesma data e mesmo tamanho.
  expect(realEnvStamp()).toBe(envStampBefore);
});

function cli(script: string, args: string[], envFile: Record<string, string> | null, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-cli-'));
  const envPath = path.join(dir, 'env.local');
  if (envFile) writeFileSync(envPath, Object.entries(envFile).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MEDIA_|R2_|DATABASE_|TEST_DATABASE|STORAGE_|NEON_|PERFUMES_)/.test(k)));
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', script, ...args], {
    encoding: 'utf8',
    timeout: 100_000,
    env: { ...base, PERFUMES_ENV_FILE: envPath, PERFUMES_DATA_DIR: dir, STORAGE_BACKEND: 'json', LOG_LEVEL: 'silent', ...extra },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, dir };
}

const SMOKE = 'apps/server/src/media/smoke-cli.ts';
const VERIFY = 'apps/server/src/media/verify-cli.ts';
const MIGRATE = 'apps/server/src/media/cli.ts';

describe('media:smoke e media:diagnose (CLI de verdade, sem rede)', () => {
  it('--help responde ANTES de ler qualquer ambiente', () => {
    const r = cli(SMOKE, ['--help'], null);
    expect(r.status).toBe(0);
    expect(r.out).toContain('media:smoke');
    expect(existsSync(path.join(r.dir, 'env.local'))).toBe(false); // nem o arquivo de ambiente foi tocado/criado
  });

  it('sem R2: RECUSA (saída 2), explica e não envia nada', () => {
    const r = cli(SMOKE, [], {});
    expect(r.status).toBe(2);
    expect(r.out).toContain('media:smoke RECUSADO');
    expect(r.out).toContain('o R2 não está configurado');
    expect(r.out).toContain('Nada foi enviado nem consultado');
    expect(r.out).toContain('MEDIA_BACKEND não precisa mudar');
    expect(r.out).not.toContain('RESULTADO: PASS');
  });

  it('R2 parcial: RECUSA e mostra QUAIS componentes faltam — nomes, nunca valores', () => {
    const r = cli(SMOKE, [], { R2_BUCKET: R2_FULL.R2_BUCKET, R2_ACCESS_KEY_ID: R2_FULL.R2_ACCESS_KEY_ID });
    expect(r.status).toBe(2);
    expect(r.out).toContain('incompleta');
    for (const name of ['R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL', 'R2_ENDPOINT ou R2_ACCOUNT_ID']) expect(r.out).toContain(name);
    for (const value of VALUES) expect(r.out).not.toContain(value);
  });

  it('R2 com a URL pública igual ao endpoint S3: RECUSA (configuração inválida)', () => {
    const r = cli(SMOKE, [], { ...R2_FULL, R2_PUBLIC_BASE_URL: `https://${ACC}.r2.cloudflarestorage.com` });
    expect(r.status).toBe(2);
    expect(r.out).toContain('valores inválidos');
    expect(r.out).toContain('R2_PUBLIC_BASE_URL');
    expect(r.out).toContain('endereço S3');
    expect(r.out).not.toContain(ACC);
  });

  it('R2 com formato inválido NÃO derruba a CLI em modo local: ela recusa com diagnóstico (em vez de um erro de partida)', () => {
    const r = cli(SMOKE, [], { ...R2_FULL, R2_BUCKET: 'Bucket_Invalido' });
    expect(r.status).toBe(2);
    expect(r.out).toContain('INVÁLIDO');
    expect(r.out).toContain('R2_BUCKET');
    expect(r.out).not.toContain('Configuração inválida:');
  });

  it('media:diagnose com tudo certo: saída 0, "completo e válido", MEDIA_BACKEND=local informado, NENHUM valor', () => {
    const r = cli(SMOKE, ['--diagnose'], R2_FULL);
    expect(r.status).toBe(0);
    expect(r.out).toContain('MEDIA_BACKEND=local');
    expect(r.out).toContain('completo e válido');
    for (const value of VALUES) expect(r.out).not.toContain(value);
  });

  it('media:diagnose com R2 parcial: saída 2 e os componentes ausentes', () => {
    const r = cli(SMOKE, ['--diagnose'], { R2_BUCKET: R2_FULL.R2_BUCKET });
    expect(r.status).toBe(2);
    expect(r.out).toContain('AUSENTE');
    expect(r.out).toContain('R2_SECRET_ACCESS_KEY');
    expect(r.out).not.toContain(R2_FULL.R2_BUCKET);
  });
});

describe('media:verify (CLI de verdade, só leitura, sem rede)', () => {
  const libraryFile = (mutate?: (lib: ReturnType<typeof fixtureLibrary>) => void) => {
    const lib = fixtureLibrary();
    mutate?.(lib);
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'perfumes-lib-')), 'library.json');
    writeFileSync(file, JSON.stringify(lib));
    return file;
  };

  it('--help', () => {
    const r = cli(VERIFY, ['--help'], null);
    expect(r.status).toBe(0);
    expect(r.out).toContain('media:verify');
  });

  it('estado pré-R2: "R2 ainda não migrado", saída 0, e NADA é criado (nem mapa, nem relatório)', () => {
    const r = cli(VERIFY, [`--file=${libraryFile()}`], {});
    expect(r.status).toBe(0);
    expect(r.out).toContain('PRÉ-R2');
    expect(r.out).toContain('R2 ainda não migrado');
    expect(r.out).toContain('RESULTADO: OK — R2 ainda não migrado');
    expect(existsSync(path.join(r.dir, 'media-map.json'))).toBe(false);
    expect(existsSync(path.join(r.dir, 'migrations'))).toBe(false);
    expect(readdirSync(r.dir).sort()).toEqual(['env.local', 'media']); // só o que a partida das CLIs sempre cria
  });

  it('--json traz o estado em JSON', () => {
    const r = cli(VERIFY, [`--file=${libraryFile()}`, '--json'], {});
    const report = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1)) as { state: string; ok: boolean };
    expect(report).toMatchObject({ state: 'pre-r2', ok: true });
  });

  it('banco com chave por conteúdo e SEM mapa: inconsistente, saída 1', () => {
    const file = libraryFile((lib) => {
      lib.products[0]!.images[0]!.url = `p/${'a'.repeat(64)}.webp`;
    });
    const r = cli(VERIFY, [`--file=${file}`], {});
    expect(r.status).toBe(1);
    expect(r.out).toContain('INCONSISTENTE');
    expect(r.out).toContain('content_refs_without_map');
    expect(r.out).toContain('RESULTADO: FALHOU');
  });

  it('com R2 parcial: avisa o que falta no R2 e segue só com o que dá sem rede', () => {
    const r = cli(VERIFY, [`--file=${libraryFile()}`], { R2_BUCKET: R2_FULL.R2_BUCKET });
    expect(r.status).toBe(0);
    expect(r.out).toContain('PRÉ-R2');
    expect(r.out).toContain('INCOMPLETO');
    expect(r.out).not.toContain(R2_FULL.R2_BUCKET);
  });
});

describe('media:migrate (CLI de verdade): diagnóstico e recusas, sem rede', () => {
  const emptyLibrary = () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'perfumes-lib-')), 'library.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 2, users: [], products: [], entries: [] }));
    return file;
  };

  it('dry-run com R2 parcial: roda, avisa "R2 NÃO configurado" e mostra o diagnóstico (nomes)', () => {
    const r = cli(MIGRATE, [`--file=${emptyLibrary()}`], { R2_BUCKET: R2_FULL.R2_BUCKET, R2_ACCESS_KEY_ID: R2_FULL.R2_ACCESS_KEY_ID });
    expect(r.status).toBe(0);
    expect(r.out).toContain('R2 NÃO configurado');
    expect(r.out).toContain('INCOMPLETO');
    expect(r.out).toContain('R2_SECRET_ACCESS_KEY');
    expect(r.out).toContain('DRY-RUN — nada foi enviado');
    expect(r.out).toContain('destino não consultado');
    for (const value of VALUES) expect(r.out).not.toContain(value);
  });

  it('--confirm com R2 parcial: RECUSA (saída 1), aponta o diagnóstico e não envia nada', () => {
    const r = cli(MIGRATE, [`--file=${emptyLibrary()}`, '--confirm'], { R2_BUCKET: R2_FULL.R2_BUCKET });
    expect(r.status).toBe(1);
    expect(r.out).toContain('--confirm precisa do R2 configurado por completo');
    expect(r.out).toContain('Veja o diagnóstico acima');
    expect(r.out).toContain('Nada foi enviado');
  });
});
