import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, parseEnv, SECRET_KEYS } from '../apps/server/src/config';
import { createLogger, safePath, safeUrl } from '../apps/server/src/log';
import { collectMediaGarbage } from '../apps/server/src/media/gc';
import { MODEL_COMMIT, MODEL_SHA256, MODEL_SIZE, sha256File, verifyModelFile } from '../apps/server/src/media/matting';
import { EgressAbortedError, EgressLimiter } from '../apps/server/src/net/egress';
import { CircuitBreaker } from '../apps/server/src/sources/circuit-breaker';
import { __resetSources, pauseSource, reportSourceFailure, source, sourceAvailable, SOURCES, sourcesStatus } from '../apps/server/src/sources/registry';
import { LocalStorageProvider } from '../apps/server/src/storage/local';
import { isValidKey } from '../apps/server/src/storage/types';

/* ------------------------------------------------------------------ configuração */

describe('configuração validada', () => {
  it('padrões de hoje sem nenhuma variável', () => {
    const env = parseEnv({});
    expect(env.PERFUMES_PORT).toBe(3100);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.EGRESS_MAX_CONCURRENT).toBe(6);
    expect(env.EGRESS_MAX_PER_MINUTE).toBe(120);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('VAR= vazio conta como não definido (o .env.example copiado funciona)', () => {
    const example = readFileSync('.env.example', 'utf8');
    const vars = Object.fromEntries(
      example
        .split(/\r?\n/)
        .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]]),
    );
    expect(Object.values(vars).every((v) => v === '')).toBe(true); // nenhum valor no modelo
    const env = parseEnv(vars);
    expect(env.PERFUMES_PORT).toBe(3100);
    expect(env.AUTH_SECRET).toBeUndefined();
  });

  it('.env.example lista as variáveis de produção pedidas', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL', 'AUTH_SECRET', 'EMAIL_PROVIDER_KEY', 'SEARCH_PROVIDER_KEY', 'SENTRY_DSN']) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });

  it.each([
    [{ PERFUMES_PORT: '70000' }, 'PERFUMES_PORT'],
    [{ PERFUMES_PORT: 'abc' }, 'PERFUMES_PORT'],
    [{ LOG_LEVEL: 'barulhento' }, 'LOG_LEVEL'],
    [{ AUTH_SECRET: 'curto' }, 'AUTH_SECRET'],
    [{ DATABASE_URL: 'mysql://x' }, 'DATABASE_URL'],
    [{ R2_PUBLIC_URL: 'http://img.exemplo.com' }, 'R2_PUBLIC_URL'],
    [{ PERFUMES_PUBLIC_ORIGIN: 'perfumes.com' }, 'PERFUMES_PUBLIC_ORIGIN'],
    [{ EGRESS_MAX_CONCURRENT: '0' }, 'EGRESS_MAX_CONCURRENT'],
  ])('valor inválido para no start: %j', (env, key) => {
    expect(() => parseEnv(env)).toThrowError(ConfigError);
    expect(() => parseEnv(env)).toThrowError(new RegExp(key));
  });

  it('a mensagem de erro não repete o valor recebido', () => {
    try {
      parseEnv({ AUTH_SECRET: 'segredo-curto-demais' });
    } catch (error) {
      expect((error as Error).message).not.toContain('segredo-curto-demais');
    }
  });

  it('describeConfig diz QUAIS segredos existem, nunca o valor', () => {
    const env = parseEnv({ PERFUMES_ACCESS_CODE: 'ABC234', SEARCH_PROVIDER_KEY: 'chave-super-secreta', AUTH_SECRET: 'x'.repeat(40) });
    const text = JSON.stringify(describeConfig(env));
    expect(text).not.toContain('ABC234');
    expect(text).not.toContain('chave-super-secreta');
    expect(text).not.toContain('x'.repeat(40));
    expect(describeConfig(env).secretsDefined).toEqual(expect.arrayContaining(['PERFUMES_ACCESS_CODE', 'SEARCH_PROVIDER_KEY', 'AUTH_SECRET']));
    expect(SECRET_KEYS).toContain('R2_SECRET_ACCESS_KEY');
  });

  it('nenhum segredo no código: .env fora do Git e nenhuma chave de verdade versionada', () => {
    const ignore = readFileSync('.gitignore', 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).toMatch(/^\/data\/$/m);
  });

  it('o .gitignore esconde os dados da raiz, mas não o código que mora numa pasta "data"', () => {
    // Sem a barra inicial, "data/" escondia também apps/web/src/data/ — e o código restaurado do Git não compilava.
    const ignored = (f: string) => spawnSync('git', ['check-ignore', '-q', f]).status === 0;
    expect(ignored('data/library.json')).toBe(true);
    expect(ignored('data/devices.json')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('apps/web/src/data/repository.ts')).toBe(false);
    expect(ignored('apps/web/src/data/seed.json')).toBe(false);
  });
});

/* ------------------------------------------------------------------ logs */

function capture(level = 'debug') {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger({ level, destination }), lines };
}

describe('logs estruturados sem segredos', () => {
  it('apaga senha, token, cookie, autorização, código de acesso e chaves', () => {
    const { logger, lines } = capture();
    logger.info({
      event: 'teste',
      password: 'senha123',
      token: 'tok-abc',
      cookie: 'perfumes_device=xyz',
      accessCode: 'ABC234',
      apiKey: 'brave-key',
      secret: 's3cr3t',
      headers: { cookie: 'a=b', authorization: 'Bearer zzz', 'set-cookie': 'c=d', 'x-subscription-token': 'k' },
      req: { headers: { cookie: 'e=f', authorization: 'Basic yyy' } },
      nested: { token: 'NESTED_TOKEN_42', password: 'NESTED_PW_42' },
    });
    const out = lines.join('');
    for (const secret of ['senha123', 'tok-abc', 'perfumes_device=xyz', 'ABC234', 'brave-key', 's3cr3t', 'a=b', 'Bearer zzz', 'c=d', 'e=f', 'Basic yyy', 'NESTED_TOKEN_42', 'NESTED_PW_42']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[removido]');
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed.event).toBe('teste');
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('perfumes-server');
  });

  it('link vira origem + caminho (sem query, fragmento ou credencial)', () => {
    expect(safeUrl('https://user:pw@loja.com/p/x?token=abc&utm=1#frag')).toBe('https://loja.com/p/x');
    expect(safeUrl('não é link')).toBe('(link inválido)');
    expect(safePath('/api/v1/imports?token=abc')).toBe('/api/v1/imports');
  });
});

/* ------------------------------------------------------------------ teto global de saída */

describe('EgressLimiter', () => {
  it('nunca passa de N conexões simultâneas', async () => {
    const limiter = new EgressLimiter(() => ({ maxConcurrent: 2, maxPerMinute: 1000 }));
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
      });
    await Promise.all(Array.from({ length: 7 }, task));
    expect(peak).toBe(2);
    expect(limiter.stats.active).toBe(0);
  });

  it('respeita o orçamento por minuto (janela deslizante)', async () => {
    let now = 0;
    const limiter = new EgressLimiter(() => ({ maxConcurrent: 10, maxPerMinute: 3 }), () => now);
    for (let i = 0; i < 3; i++) (await limiter.acquire())();
    let fourth = false;
    const pending = limiter.acquire().then((release) => {
      fourth = true;
      release();
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fourth).toBe(false); // o quarto espera
    now = 60_001; // passou um minuto: a próxima liberação acorda quem espera, que recalcula a janela
    (await limiter.acquire())();
    await pending;
    expect(fourth).toBe(true);
  });

  it('pedido cancelado enquanto espera sai da fila', async () => {
    const limiter = new EgressLimiter(() => ({ maxConcurrent: 1, maxPerMinute: 100 }));
    const release = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(EgressAbortedError);
    release();
    expect(limiter.stats.active).toBe(0);
  });
});

/* ------------------------------------------------------------------ fontes e disjuntor */

describe('CircuitBreaker', () => {
  it('abre depois de N falhas, testa uma vez depois do tempo e fecha com sucesso', () => {
    let now = 0;
    const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    b.recordFailure();
    expect(b.state).toBe('closed');
    b.recordFailure('timeout');
    expect(b.state).toBe('open');
    expect(b.canRequest()).toBe(false);
    now = 1001;
    expect(b.state).toBe('half-open');
    expect(b.canRequest()).toBe(true); // o pedido de teste
    expect(b.canRequest()).toBe(false); // só um por vez
    b.recordSuccess();
    expect(b.state).toBe('closed');
  });

  it('falha no teste reabre', () => {
    let now = 0;
    const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => now });
    b.recordFailure();
    now = 150;
    expect(b.canRequest()).toBe(true);
    b.recordFailure();
    expect(b.state).toBe('open');
  });

  it('pausa explícita (site pediu verificação) vale mesmo sem limite de falhas', () => {
    let now = 0;
    const b = new CircuitBreaker({ failureThreshold: null, cooldownMs: 0, now: () => now });
    for (let i = 0; i < 50; i++) b.recordFailure();
    expect(b.state).toBe('closed');
    b.trip(30 * 60_000, 'verificação');
    expect(b.canRequest()).toBe(false);
    expect(b.snapshot.reason).toBe('verificação');
    now = 30 * 60_000 + 1;
    expect(b.isAvailable()).toBe(true);
  });
});

describe('registro de fontes', () => {
  it('descreve o motor atual com todos os papéis pedidos', () => {
    const kinds = new Set(SOURCES.map((s) => s.kind));
    for (const k of ['catalog', 'productPage', 'officialStore', 'perfumeDatabase', 'searchAPI', 'reseller']) expect(kinds).toContain(k);
    for (const s of SOURCES) {
      expect(s.timeoutMs).toBeGreaterThan(0);
      expect(s.quality).toBeGreaterThan(0);
      expect(s.quality).toBeLessThanOrEqual(1);
      expect(s.rateLimit.perHostMs).toBeGreaterThan(0);
    }
    expect(new Set(SOURCES.map((s) => s.priority)).size).toBe(SOURCES.length);
  });

  it('pausa do DuckDuckGo e da Fragrantica passam pelo disjuntor', () => {
    __resetSources();
    expect(sourceAvailable('duckduckgo')).toBe(true);
    pauseSource('duckduckgo', 30 * 60_000, 'verificação anti-robô');
    expect(sourceAvailable('duckduckgo')).toBe(false);
    expect(sourcesStatus().find((s) => s.id === 'duckduckgo')?.breaker.state).toBe('open');
    for (let i = 0; i < source('fragrantica').breaker.failureThreshold!; i++) reportSourceFailure('fragrantica', 'timeout');
    expect(sourceAvailable('fragrantica')).toBe(false);
    __resetSources();
  });

  it('Brave só fica disponível com chave', () => {
    const before = process.env.SEARCH_PROVIDER_KEY;
    expect(source('brave').requires?.()).toBe(Boolean(before || process.env.BRAVE_SEARCH_API_KEY));
  });

  it('o retrato das fontes não carrega chave nenhuma', () => {
    expect(JSON.stringify(sourcesStatus())).not.toMatch(/key|token|secret/i);
  });
});

/* ------------------------------------------------------------------ armazenamento */

describe('LocalStorageProvider', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'perfumes-storage-'));
  const storage = new LocalStorageProvider(() => root, 'media/');

  it('put / get / exists / publicUrl / delete', async () => {
    await storage.put('abc-lg.webp', Buffer.from('webp!'), { contentType: 'image/webp' });
    expect(await storage.exists('abc-lg.webp')).toBe(true);
    const got = await storage.get('abc-lg.webp');
    expect(got?.body.toString()).toBe('webp!');
    expect(got?.contentType).toBe('image/webp');
    expect(storage.publicUrl('abc-lg.webp')).toBe('media/abc-lg.webp');
    expect(await storage.delete('abc-lg.webp')).toBe(true);
    expect(await storage.exists('abc-lg.webp')).toBe(false);
    expect(await storage.delete('abc-lg.webp')).toBe(false);
  });

  it('gravação atômica não deixa arquivo temporário', async () => {
    await storage.put('x.png', Buffer.alloc(1000), { contentType: 'image/png' });
    expect(readdirSync(root).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it.each(['../fora.png', '/abs.png', 'a/../../b.png', 'a/./b.png', '..', '', 'C:\\x.png', 'a\\..\\b.png', 'x.png\0', ' espaço.png', '.oculto'])('recusa chave %j', async (key) => {
    expect(isValidKey(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.put(key, Buffer.from('x'), { contentType: 'image/png' })).rejects.toThrow();
  });

  it('lista inclusive subpastas', async () => {
    await storage.put('bottles/ab/cd.webp', Buffer.from('1'), { contentType: 'image/webp' });
    expect((await storage.list()).map((e) => e.key)).toEqual(expect.arrayContaining(['x.png', 'bottles/ab/cd.webp']));
  });
});

describe('limpeza de mídia pelo armazenamento', () => {
  it('tira só órfãos antigos do nível de cima — para a lixeira, nunca apagando; respeita referências, carência e subpastas', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'perfumes-gc-'));
    const storage = new LocalStorageProvider(() => root, 'media/');
    for (const key of ['usada-lg.webp', 'orfa-lg.webp', 'nova-lg.webp', 'nota.txt', 'sub/orfa.png']) await storage.put(key, Buffer.from('x'), { contentType: 'image/webp' });
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    for (const f of ['usada-lg.webp', 'orfa-lg.webp', 'nota.txt']) utimesSync(path.join(root, f), old, old);
    utimesSync(path.join(root, 'sub', 'orfa.png'), old, old);
    const trashDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-lixeira-'));
    const trash = new LocalStorageProvider(() => trashDir, 'orfas/');
    const result = await collectMediaGarbage(new Set(['media/usada-lg.webp']), 6 * 60 * 60 * 1000, storage, Date.now(), trash);
    expect(result.removed).toBe(1);
    expect(existsSync(path.join(root, 'orfa-lg.webp'))).toBe(false);
    // O órfão não foi apagado: está na lixeira, com o mesmo conteúdo.
    expect(readFileSync(path.join(trashDir, 'orfa-lg.webp'), 'utf8')).toBe('x');
    expect(readdirSync(trashDir)).toEqual(['orfa-lg.webp']);
    for (const kept of ['usada-lg.webp', 'nova-lg.webp', 'nota.txt', path.join('sub', 'orfa.png')]) expect(existsSync(path.join(root, kept))).toBe(true);
  });
});

/* ------------------------------------------------------------------ modelo de IA fixado */

describe('modelo de recorte fixado por SHA-256', () => {
  it('hash, tamanho e commit fixados', () => {
    expect(MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(MODEL_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(MODEL_SIZE).toBe(224_005_088);
  });

  it('arquivo diferente (mesmo tamanho ou não) é recusado', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-model-'));
    const file = path.join(dir, 'model.onnx');
    writeFileSync(file, 'modelo falso');
    const real = createHash('sha256').update('modelo falso').digest('hex');
    expect(await sha256File(file)).toBe(real);
    expect(await verifyModelFile(file, { sha256: real, size: 12 })).toBe(true);
    expect(await verifyModelFile(file, { sha256: '0'.repeat(64), size: 12 })).toBe(false); // conteúdo trocado
    expect(await verifyModelFile(file, { sha256: real, size: 13 })).toBe(false); // tamanho errado
    expect(await verifyModelFile(path.join(dir, 'nao-existe.onnx'))).toBe(false);
  });

  const local = path.join('data', 'models', 'birefnet-lite.onnx');
  it.skipIf(!existsSync(local))('o modelo instalado neste computador bate com o hash fixado', async () => {
    expect(await verifyModelFile(local)).toBe(true);
  }, 60_000);
});

/* ------------------------------------------------------------------ banco (FASE 2) */

describe('configuração do banco', () => {
  it('padrão continua json; postgres exige DATABASE_URL', () => {
    expect(parseEnv({}).STORAGE_BACKEND).toBe('json');
    expect(() => parseEnv({ STORAGE_BACKEND: 'postgres' })).toThrowError(/DATABASE_URL/);
    expect(parseEnv({ STORAGE_BACKEND: 'postgres', DATABASE_URL: 'postgres://u:p@h/db?sslmode=require' }).STORAGE_BACKEND).toBe('postgres');
    expect(() => parseEnv({ STORAGE_BACKEND: 'mysql' })).toThrowError(ConfigError);
  });

  it('pglite: só fora de produção; esquemas estranhos recusados', () => {
    expect(parseEnv({ DATABASE_URL: 'pglite:data/pg' }).DATABASE_URL).toBe('pglite:data/pg');
    expect(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'pglite:data/pg' })).toThrowError(/produção/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrowError(/DATABASE_URL/);
  });

  it('a URL do banco nunca aparece no retrato da configuração nem na mensagem de erro', () => {
    const url = 'postgres://dono:SENHA-SECRETA-42@ep-x.neon.tech/perfumes?sslmode=require';
    const env = parseEnv({ STORAGE_BACKEND: 'postgres', DATABASE_URL: url, DATABASE_URL_UNPOOLED: url });
    const text = JSON.stringify(describeConfig(env));
    expect(text).not.toContain('SENHA-SECRETA-42');
    expect(text).not.toContain('ep-x.neon.tech');
    expect(describeConfig(env)).toMatchObject({ storageBackend: 'postgres', database: 'postgres' });
    expect(describeConfig(env).secretsDefined).toEqual(expect.arrayContaining(['DATABASE_URL', 'DATABASE_URL_UNPOOLED']));
    try {
      parseEnv({ DATABASE_URL: 'mysql://dono:SENHA-SECRETA-42@h/db' });
    } catch (error) {
      expect((error as Error).message).not.toContain('SENHA-SECRETA-42');
    }
  });

  it('migrations versionadas no repositório (sem drizzle-kit push)', () => {
    const journal = JSON.parse(readFileSync('apps/server/drizzle/meta/_journal.json', 'utf8'));
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toContain('0000_inicial');
    const pkg = readFileSync('package.json', 'utf8') + readFileSync('apps/server/package.json', 'utf8');
    expect(pkg).not.toMatch(/drizzle-kit push/);
    expect(pkg).toMatch(/"db:migrate"/);
  });
});

describe('banco de testes nunca é o principal', () => {
  const principal = 'postgresql://dono:senha@ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const principalDireto = 'postgresql://dono:senha@ep-cool-sun-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const branchTestes = 'postgresql://dono:senha@ep-quiet-moon-z9y8x7-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

  it('pooler e conexão direta do mesmo branch são o MESMO ambiente', async () => {
    const { sameTarget } = await import('../apps/server/src/db/targets');
    expect(sameTarget(principal, principalDireto)).toBe(true);
    expect(sameTarget(principal, branchTestes)).toBe(false);
  });

  it('recusa: igual ao principal, mesmo endpoint com outro nome de banco, vazio ou não-postgres', async () => {
    const { testTargetRefusal } = await import('../apps/server/src/db/targets');
    expect(testTargetRefusal(principal, [principal, principalDireto])).toMatch(/MESMO banco/);
    expect(testTargetRefusal(principalDireto, [principal])).toMatch(/MESMO banco/);
    expect(testTargetRefusal(principal.replace('/neondb', '/outro'), [principal])).toMatch(/MESMO endpoint/);
    expect(testTargetRefusal('', [principal])).toMatch(/não está configurada/);
    expect(testTargetRefusal('pglite:x', [principal])).toMatch(/não é/);
    expect(testTargetRefusal(branchTestes, [principal, principalDireto])).toBeNull();
  });

  it('a descrição mascara o host e nunca inclui usuário, senha ou a URL', async () => {
    const { describeTarget } = await import('../apps/server/src/db/targets');
    const t = describeTarget(branchTestes);
    expect(JSON.stringify({ host: t.host, pooled: t.pooled, database: t.database })).not.toMatch(/senha|dono|quiet-moon-z9y8x7|postgresql:/);
    expect(t).toMatchObject({ kind: 'postgres', pooled: true, database: 'neondb' });
    expect(t.host).toMatch(/^ep-q…x7-pooler\.eu-central-1\.aws\.neon\.tech$/);
  });
});

describe('validação única do banco de testes (db:targets = test:neon = smoke = helpers)', () => {
  const principal = 'postgresql://dono:senha@ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const principalDireto = 'postgresql://dono:senha@ep-cool-sun-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const testes = 'postgresql://dono:senha@ep-quiet-moon-z9y8x7-pooler.eu-central-1.aws.neon.tech/testes?sslmode=require';
  const env = (over: Record<string, string>) => {
    const all: Record<string, string> = { DATABASE_URL: principal, DATABASE_URL_UNPOOLED: principalDireto, TEST_DATABASE_URL: testes, ...over };
    return (k: string) => all[k] ?? '';
  };

  it('libera um branch separado, com pooler e com o nome esperado', async () => {
    const { checkTestTarget } = await import('../apps/server/src/db/targets');
    expect(checkTestTarget(env({ NEON_TEST_DATABASE_NAME: 'testes' }))).toMatchObject({ ok: true, refusals: [] });
    expect(checkTestTarget(env({})).ok).toBe(true); // sem a variável, a proteção por nome fica desligada
  });

  it.each<[string, Record<string, string>, RegExp]>([
    ['nome do database diferente do esperado', { NEON_TEST_DATABASE_NAME: 'testes_ci' }, /esperado "testes_ci".*encontrado "testes"/],
    ['sem pooler', { TEST_DATABASE_URL: testes.replace('-pooler', '') }, /não passa pelo pooler/],
    ['igual ao principal', { TEST_DATABASE_URL: principal }, /MESMO banco/],
    ['conexão direta do principal', { TEST_DATABASE_URL: principalDireto }, /MESMO banco/],
    ['mesmo endpoint/branch com outro database', { TEST_DATABASE_URL: principal.replace('/neondb', '/testes') }, /MESMO endpoint/],
    ['não configurada', { TEST_DATABASE_URL: '' }, /não está configurada/],
  ])('RECUSA: %s', async (_label, over, reason) => {
    const { checkTestTarget } = await import('../apps/server/src/db/targets');
    const check = checkTestTarget(env(over));
    expect(check.ok).toBe(false);
    expect(check.refusals.join('\n')).toMatch(reason);
    expect(check.refusals.join('\n')).not.toMatch(/senha|dono:|postgresql:\/\//);
  });
});

describe('backup antes do primeiro write no banco principal', () => {
  const principal = 'postgresql://dono:senha@ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  it('sem backup, backup de outro banco, antigo ou de outro library.json: RECUSA; backup certo: libera', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-bkp-'));
    const before = process.env.PERFUMES_DATA_DIR;
    process.env.PERFUMES_DATA_DIR = dir;
    const { reloadConfig } = await import('../apps/server/src/config');
    reloadConfig();
    try {
      const { backupRefusal, targetFingerprint, sha256 } = await import('../apps/server/src/db/backup');
      writeFileSync(path.join(dir, 'library.json'), '{"a":1}');
      expect(backupRefusal(principal)).toMatch(/não há backup/);
      const save = (name: string, over: Record<string, unknown>) => {
        const d = path.join(dir, 'backups', name);
        mkdirSync(d, { recursive: true });
        const manifest = { kind: 'backup-before-neon', createdAt: new Date().toISOString(), target: { fingerprint: targetFingerprint(principal) }, libraryJson: { sha256: sha256('{"a":1}') }, ...over };
        writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(manifest));
      };
      save('backup-before-neon-20260101-000000', { target: { fingerprint: targetFingerprint('postgresql://x:y@ep-outro-banco-pooler.neon.tech/neondb') } });
      expect(backupRefusal(principal)).toMatch(/não há backup/);
      save('backup-before-neon-20260101-000001', { createdAt: new Date(Date.now() - 13 * 3600_000).toISOString() });
      expect(backupRefusal(principal)).toMatch(/mais de 12 h/);
      save('backup-before-neon-20260101-000002', { libraryJson: { sha256: sha256('outro') } });
      expect(backupRefusal(principal)).toMatch(/library.json mudou/);
      save('backup-before-neon-20260101-000003', { createdAt: new Date(Date.now() + 1000).toISOString() });
      expect(backupRefusal(principal)).toBeNull();
      // Pooler e conexão direta do mesmo banco = o mesmo backup vale.
      expect(backupRefusal(principal.replace('-pooler', ''))).toBeNull();
    } finally {
      if (before === undefined) delete process.env.PERFUMES_DATA_DIR;
      else process.env.PERFUMES_DATA_DIR = before;
      reloadConfig();
    }
  });
});

describe('TLS do driver pg fixado em verify-full (sem mudar credenciais)', () => {
  const base = 'postgresql://dono:senha@ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb';
  it.each([
    ['require', 'verify-full'],
    ['prefer', 'verify-full'],
    ['verify-ca', 'verify-full'],
    ['verify-full', 'verify-full'],
    ['disable', 'disable'],
  ])('sslmode=%s → %s', async (from, to) => {
    const { pgConnectionOptions } = await import('../apps/server/src/db/client');
    expect(new URL(pgConnectionOptions(`${base}?sslmode=${from}`).connectionString).searchParams.get('sslmode')).toBe(to);
  });

  it('channel_binding=require liga enableChannelBinding; usuário, senha, host e banco não mudam', async () => {
    const { pgConnectionOptions } = await import('../apps/server/src/db/client');
    const o = pgConnectionOptions(`${base}?sslmode=require&channel_binding=require`);
    expect(o.enableChannelBinding).toBe(true);
    const u = new URL(o.connectionString);
    expect([u.username, u.password, u.hostname, u.pathname]).toEqual(['dono', 'senha', 'ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech', '/neondb']);
    expect(pgConnectionOptions(`${base}?sslmode=require`).enableChannelBinding).toBeUndefined();
    expect(pgConnectionOptions(base).connectionString).toBe(base);
  });
});
