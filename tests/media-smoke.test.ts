import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diagnoseR2 } from '../apps/server/src/config';
import { formatSmokeReport, makeRedactor, planSmoke, probePublic, runSmoke, scopedRemote, SmokeScopeError, type PublicFetch, type SmokeReport } from '../apps/server/src/media/smoke';
import { R2StorageProvider } from '../apps/server/src/storage/r2';
import type { PutOptions } from '../apps/server/src/storage/types';
import { FakeR2StorageProvider } from './helpers/fake-r2';
import { startFakeS3, xmlError, type FakeS3 } from './helpers/fake-s3-server';
import { networkTrap } from './helpers/media-fixtures';

/**
 * FASE 3.1 (hardening sem credenciais) — `media:smoke`: o teste de ponta a ponta do R2 com UM objeto descartável.
 * Nada aqui fala com a Cloudflare: R2 falso em memória, servidor S3 falso em 127.0.0.1 e um `fetch` público falso.
 * Uma armadilha derruba o teste se algo chamar o `fetch` global para fora do laço local (a rede de verdade).
 */

const FIXED = { now: () => new Date('2026-09-30T17:30:00.000Z'), randomId: () => 'aa11bb22' };
const PREFIX = 'healthcheck/20260930T173000Z-aa11bb22/';
const PROBE = `${PREFIX}probe.txt`;
const pkey = (c: string) => `p/${c.repeat(64)}.webp`;

let trap: ReturnType<typeof networkTrap>;
beforeEach(() => {
  trap = networkTrap();
});
afterEach(() => {
  expect(trap.offending).toEqual([]);
  trap.restore();
});

/** A URL pública "serve" o que está no R2 falso (como um bucket público de verdade serviria). */
const servePublic =
  (remote: FakeR2StorageProvider): PublicFetch =>
  async (url) => {
    const object = remote.objects.get(new URL(url).pathname.slice(1));
    return object ? new Response(new Uint8Array(object.body), { status: 200 }) : new Response('não encontrado', { status: 404 });
  };

/** R2 falso que anota toda chave tocada, em qualquer operação. */
class Recording extends FakeR2StorageProvider {
  readonly touched: string[] = [];
  override async put(key: string, body: Buffer, options: PutOptions) {
    this.touched.push(key);
    return super.put(key, body, options);
  }
  override async get(key: string) {
    this.touched.push(key);
    return super.get(key);
  }
  override async exists(key: string) {
    this.touched.push(key);
    return super.exists(key);
  }
  override async delete(key: string) {
    this.touched.push(key);
    return super.delete(key);
  }
}

const ids = (r: SmokeReport) => r.steps.map((s) => `${s.id}:${s.status}`);

describe('o caminho feliz', () => {
  it('PASS: 9 etapas, só o prefixo do próprio teste, só o probe.txt apagado, nada mais tocado', async () => {
    const remote = new Recording();
    const others = [pkey('a'), pkey('b'), 'healthcheck/antigo/probe.txt'];
    for (const k of others) await remote.put(k, Buffer.from(k), { contentType: 'text/plain' });
    remote.touched.length = 0;
    remote.calls.put = 0;

    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });

    expect(report.ok).toBe(true);
    expect(report.prefix).toBe(PREFIX);
    expect(ids(report)).toEqual(['access:pass', 'put:pass', 'exists:pass', 'get:pass', 'list:pass', 'absent:pass', 'public:pass', 'delete:pass', 'gone:pass']);
    expect(report.cleanup).toBe('deleted');
    expect(report.failure).toBeUndefined();
    // Só chaves do prefixo do teste foram tocadas; o que já existia continua lá, intacto.
    expect(remote.touched.every((k) => k.startsWith(PREFIX))).toBe(true);
    expect(new Set(remote.touched)).toEqual(new Set([PROBE, `${PREFIX}absent.txt`]));
    expect(remote.deleted).toEqual([PROBE]);
    expect([...remote.objects.keys()].sort()).toEqual([...others].sort());
    // Nunca uma listagem global: toda listagem leva o prefixo do teste.
    expect(remote.listed.length).toBeGreaterThanOrEqual(2);
    expect(remote.listed.every((p) => p === PREFIX)).toBe(true);
    expect(remote.calls.put).toBe(1);
    expect(remote.calls.access).toBe(1);
  });

  it('a prova pública baixa a URL do objeto de teste (não o endereço S3), sem seguir redirecionamentos', async () => {
    const remote = new FakeR2StorageProvider();
    const calls: { url: string; redirect: string; during: string[] }[] = [];
    const fetchPublic: PublicFetch = async (url, init) => {
      calls.push({ url, redirect: init.redirect, during: [...remote.objects.keys()] });
      return servePublic(remote)(url, init);
    };
    const report = await runSmoke({ remote, fetchPublic, ...FIXED });
    expect(report.ok).toBe(true);
    expect(calls).toEqual([{ url: remote.publicUrl(PROBE), redirect: 'manual', during: [PROBE] }]);
  });

  it('o relatório impresso termina em PASS inequívoco e traz cada etapa', async () => {
    const remote = new FakeR2StorageProvider();
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    const lines = formatSmokeReport(report, 'img.exemplo.test');
    expect(lines.at(-1)).toBe('RESULTADO: PASS');
    expect(lines.join('\n')).not.toMatch(/FAIL|SKIP/);
    expect(lines.filter((l) => l.includes('PASS')).length).toBe(10); // 9 etapas + o resultado
    expect(lines.join('\n')).toContain(`${PREFIX}probe.txt`);
    expect(lines.join('\n')).toContain('img.exemplo.test');
  });

  it('identificador próprio a cada execução (data-hora + aleatório) e prefixo válido', async () => {
    const remote = new FakeR2StorageProvider();
    const a = await runSmoke({ remote, fetchPublic: servePublic(remote) });
    const b = await runSmoke({ remote, fetchPublic: servePublic(remote) });
    expect(a.prefix).toMatch(/^healthcheck\/\d{8}T\d{6}Z-[0-9a-f]{8}\/$/);
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.ok && b.ok).toBe(true);
  });
});

describe('falhas: cada causa aparece como ela é, as etapas seguintes são puladas e a limpeza roda', () => {
  it.each([
    ['token sem permissão no bucket', 'access', 'access_denied', 'autenticação'],
    ['assinatura recusada', 'access', 'signature', 'autenticação'],
    ['chave de acesso desconhecida', 'access', 'invalid_credentials', 'autenticação'],
    ['bucket inexistente', 'access', 'no_such_bucket', 'bucket'],
    ['endereço que não é S3', 'access', 'endpoint', 'S3'],
    ['servidor fora do ar', 'access', 'server', 'S3'],
    ['sem resposta no acesso', 'access', 'timeout', 'timeout'],
  ] as const)('%s → etapa access, causa %s, grupo %s; nada é enviado', async (_label, step, cause, group) => {
    const remote = new FakeR2StorageProvider().fail('access', cause);
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.ok).toBe(false);
    expect(report.failure).toMatchObject({ step, cause, group });
    expect(ids(report)).toEqual(['access:fail', ...['put', 'exists', 'get', 'list', 'absent', 'public', 'delete', 'gone'].map((s) => `${s}:skip`)]);
    expect(remote.calls.put).toBe(0);
    expect(report.cleanup).toBe('not_needed');
    expect(formatSmokeReport(report).at(-1)).toMatch(new RegExp(`^RESULTADO: FAIL — etapa "access", causa: ${group}`));
  });

  it('o envio falha: a limpeza confere (só o probe.txt) e não sobra nada', async () => {
    const remote = new Recording().fail('put', 'signature');
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'put', cause: 'signature', group: 'autenticação' });
    expect(report.cleanup).toBe('not_needed');
    expect(remote.objects.size).toBe(0);
    expect(remote.touched.every((k) => k === PROBE)).toBe(true);
  });

  it('o S3 aceita o envio mas o objeto não aparece → objeto inexistente', async () => {
    const remote = new FakeR2StorageProvider().fail('put', 'drop');
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'exists', cause: 'object_missing', group: 'objeto' });
  });

  it('o S3 devolve um byte trocado → conteúdo incorreto; o objeto é apagado na limpeza', async () => {
    const remote = new FakeR2StorageProvider().fail('get', 'corrupt');
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'get', cause: 'content_mismatch', group: 'conteúdo' });
    expect(report.cleanup).toBe('deleted');
    expect(remote.objects.size).toBe(0);
  });

  it('o S3 devolve só metade do conteúdo (envio interrompido) → conteúdo incorreto', async () => {
    const remote = new FakeR2StorageProvider().fail('put', 'truncate');
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'get', cause: 'content_mismatch' });
    expect(report.cleanup).toBe('deleted');
  });

  it('timeout no meio → grupo timeout; limpeza roda', async () => {
    const remote = new FakeR2StorageProvider().fail('exists', 'timeout');
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'exists', cause: 'timeout', group: 'timeout' });
    expect(report.cleanup).toBe('deleted');
  });

  it('a listagem do prefixo traz mais que o objeto de teste → conteúdo incorreto (e o que não é do teste não é apagado)', async () => {
    const remote = new FakeR2StorageProvider();
    await remote.put(`${PREFIX}extra.txt`, Buffer.from('x'), { contentType: 'text/plain' });
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'list', cause: 'list_mismatch', group: 'conteúdo' });
    expect(remote.deleted).toEqual([PROBE]);
    expect(remote.objects.has(`${PREFIX}extra.txt`)).toBe(true);
  });

  it('a remoção falha uma vez → a limpeza tenta de novo e apaga; o smoke continua FAIL', async () => {
    const remote = new FakeR2StorageProvider().fail('delete', 'unavailable', 1);
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.ok).toBe(false);
    expect(report.failure).toMatchObject({ step: 'delete' });
    expect(report.cleanup).toBe('deleted');
    expect(remote.objects.size).toBe(0);
  });

  it('a remoção nunca funciona → limpeza FALHOU, e o relatório diz qual chave apagar (só o probe.txt)', async () => {
    const remote = new FakeR2StorageProvider().fail('delete', 'unavailable', 5);
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.ok).toBe(false);
    expect(report.cleanup).toBe('failed');
    const text = formatSmokeReport(report).join('\n');
    expect(text).toContain(`apague ${PROBE}`);
    expect(text).toContain('RESULTADO: FAIL');
  });

  it('o objeto continua existindo depois de apagado → limpeza incompleta detectada', async () => {
    class Sticky extends FakeR2StorageProvider {
      override async exists(key: string) {
        return key === PROBE ? true : super.exists(key);
      }
    }
    const remote = new Sticky();
    const report = await runSmoke({ remote, fetchPublic: servePublic(remote), ...FIXED });
    expect(report.failure).toMatchObject({ step: 'gone', cause: 'still_exists', group: 'limpeza' });
  });
});

describe('a URL pública: S3 ok, domínio público não — a causa certa aparece', () => {
  const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const cert = Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });

  it.each([
    ['nome não encontrado (DNS)', async () => Promise.reject(dns), 'public_dns', 'domínio público'],
    ['conexão recusada', async () => Promise.reject(refused), 'public_connection', 'domínio público'],
    ['certificado vencido', async () => Promise.reject(cert), 'public_tls', 'domínio público'],
    ['404 (acesso público desligado ou domínio de outro bucket)', async () => new Response('x', { status: 404 }), 'public_not_found', 'domínio público'],
    ['403', async () => new Response('x', { status: 403 }), 'public_forbidden', 'domínio público'],
    ['redirecionamento', async () => new Response(null, { status: 302, headers: { location: 'https://outro.exemplo.test/' } }), 'public_redirect', 'domínio público'],
    ['502 do proxy', async () => new Response('x', { status: 502 }), 'public_server', 'domínio público'],
    ['status estranho', async () => new Response('x', { status: 418 }), 'public_status', 'domínio público'],
    ['200 com uma página de erro no lugar do arquivo', async () => new Response('<html>erro</html>', { status: 200 }), 'public_wrong_content', 'conteúdo'],
  ] as const)('%s → %s (%s)', async (_label, publicFetch, cause, group) => {
    const remote = new FakeR2StorageProvider();
    const report = await runSmoke({ remote, fetchPublic: publicFetch as PublicFetch, ...FIXED });
    expect(report.failure).toMatchObject({ step: 'public', cause, group });
    // Tudo do S3 passou: o problema é só o domínio público.
    expect(ids(report).slice(0, 6)).toEqual(['access:pass', 'put:pass', 'exists:pass', 'get:pass', 'list:pass', 'absent:pass']);
    expect(report.cleanup).toBe('deleted');
    expect(remote.objects.size).toBe(0);
    expect(formatSmokeReport(report).at(-1)).toContain(`causa: ${group}`);
  });

  it('200 com o arquivo cortado pela metade → conteúdo incorreto (HTTP 200 não basta)', async () => {
    const remote = new FakeR2StorageProvider();
    const half: PublicFetch = async (url) => {
      const object = remote.objects.get(new URL(url).pathname.slice(1))!;
      return new Response(new Uint8Array(object.body.subarray(0, 5)), { status: 200 });
    };
    const report = await runSmoke({ remote, fetchPublic: half, ...FIXED });
    expect(report.failure).toMatchObject({ step: 'public', cause: 'public_wrong_content' });
  });

  it('sem resposta do domínio público dentro do tempo → grupo timeout', async () => {
    const remote = new FakeR2StorageProvider();
    const hang: PublicFetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const report = await runSmoke({ remote, fetchPublic: hang, timeoutMs: 40, ...FIXED });
    expect(report.failure).toMatchObject({ step: 'public', cause: 'public_timeout', group: 'timeout' });
    expect(report.cleanup).toBe('deleted');
  });

  it('probePublic (também usado pelo media:verify) compara tamanho E SHA-256', async () => {
    const body = Buffer.from('conteúdo exato');
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(body).digest('hex');
    const serve = (b: Buffer): PublicFetch => async () => new Response(new Uint8Array(b), { status: 200 });
    expect((await probePublic('https://img.exemplo.test/x', { sha256: sha, bytes: body.length }, serve(body))).ok).toBe(true);
    expect((await probePublic('https://img.exemplo.test/x', { sha256: sha, bytes: body.length }, serve(Buffer.from('conteúdo exatO')))).cause).toBe('public_wrong_content');
    expect((await probePublic('https://img.exemplo.test/x', { sha256: sha, bytes: body.length + 1 }, serve(body))).cause).toBe('public_wrong_content');
  });
});

describe('travas: o smoke não consegue tocar em mais nada', () => {
  const prefix = PREFIX;
  it('prefixo de teste fora do formato é recusado', () => {
    const remote = new FakeR2StorageProvider();
    for (const bad of ['', 'healthcheck/', 'healthcheck/x/', 'p/', pkey('a'), 'healthcheck/20260930T173000Z-aa11bb22', 'healthcheck/20260930T173000Z-zz/', '../healthcheck/20260930T173000Z-aa11bb22/']) {
      expect(() => scopedRemote(remote, bad), bad).toThrow(SmokeScopeError);
    }
    expect(() => scopedRemote(remote, prefix)).not.toThrow();
  });

  it('chaves p/…, de outro prefixo, em subpastas ou fora do molde nunca passam — em nenhuma operação', async () => {
    const remote = new FakeR2StorageProvider();
    const scope = scopedRemote(remote, prefix);
    const outside = [pkey('a'), 'healthcheck/antigo/probe.txt', `${prefix}sub/probe.txt`, `${prefix}probe.webp`, `${prefix}PROBE.txt`, `${prefix}..`, 'probe.txt'];
    for (const key of outside) {
      expect(() => scope.publicUrl(key), key).toThrow(SmokeScopeError);
      await expect(scope.get(key), key).rejects.toBeInstanceOf(SmokeScopeError);
      await expect(scope.exists(key), key).rejects.toBeInstanceOf(SmokeScopeError);
      await expect(scope.delete(key), key).rejects.toBeInstanceOf(SmokeScopeError);
      await expect(scope.put(key, Buffer.from('x'), { contentType: 'text/plain' }), key).rejects.toBeInstanceOf(SmokeScopeError);
    }
    expect(remote.calls).toEqual({ put: 0, get: 0, exists: 0, delete: 0, list: 0, access: 0 });
  });

  it('só o probe.txt do próprio teste pode ser apagado (nem o absent.txt, nem o bucket)', async () => {
    const remote = new FakeR2StorageProvider();
    const scope = scopedRemote(remote, prefix);
    await expect(scope.delete(`${prefix}absent.txt`)).rejects.toBeInstanceOf(SmokeScopeError);
    expect(remote.deleted).toEqual([]);
    await scope.put(PROBE, Buffer.from('x'), { contentType: 'text/plain' });
    expect(await scope.delete(PROBE)).toBe(true);
    expect(remote.deleted).toEqual([PROBE]);
    // O escopo nem tem operação de apagar bucket ou prefixo: só estas.
    expect(Object.keys(scope).sort()).toEqual(['checkAccess', 'delete', 'exists', 'get', 'list', 'prefix', 'publicUrl', 'put']);
  });

  it('a listagem do escopo é SEMPRE o prefixo do teste', async () => {
    const remote = new FakeR2StorageProvider();
    await scopedRemote(remote, prefix).list();
    expect(remote.listed).toEqual([prefix]);
  });
});

describe('contra o servidor S3 falso (HTTP de verdade): o que realmente vai pela rede', () => {
  let s3: FakeS3;
  beforeAll(async () => {
    s3 = await startFakeS3();
  });
  afterAll(() => s3.close());

  const SECRET = 'segredo-de-teste-nao-real';
  const ACCESS = 'chave-de-teste-nao-real';
  const settings = () => ({ endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: ACCESS, secretAccessKey: SECRET, publicBaseUrl: 'https://img.exemplo.test' });
  const publicFromS3: PublicFetch = async (url) => {
    const object = s3.objects.get(new URL(url).pathname.slice(1));
    return object ? new Response(new Uint8Array(object.body), { status: 200 }) : new Response('nf', { status: 404 });
  };

  it('PASS completo: um único DELETE, no objeto de teste; nunca no bucket; nunca em p/…; toda listagem com prefixo healthcheck/', async () => {
    const survivors = [pkey('a'), pkey('b'), 'healthcheck/antigo/probe.txt'];
    for (const k of survivors) s3.objects.set(k, { body: Buffer.from(k), contentType: 'text/plain', modified: new Date() });
    const before = s3.requests.length;

    const report = await runSmoke({ remote: new R2StorageProvider(settings(), { timeoutMs: 2000 }), fetchPublic: publicFromS3, ...FIXED });
    expect(report.ok).toBe(true);

    const sent = s3.requests.slice(before);
    const deletes = sent.filter((r) => r.method === 'DELETE');
    expect(deletes.map((r) => r.path)).toEqual([`/${s3.bucket}/${PROBE}`]);
    expect(sent.filter((r) => r.method === 'DELETE' && r.path.replace(/\/+$/, '') === `/${s3.bucket}`)).toEqual([]);
    const lists = sent.filter((r) => r.query.get('list-type') === '2');
    expect(lists.length).toBeGreaterThanOrEqual(3);
    expect(lists.every((r) => (r.query.get('prefix') ?? '').startsWith('healthcheck/'))).toBe(true);
    // Toda requisição de objeto é sob healthcheck/<id>/ — nenhuma chave p/… foi tocada.
    const objectPaths = sent.filter((r) => r.path !== `/${s3.bucket}`).map((r) => r.path);
    expect(objectPaths.every((p) => p.startsWith(`/${s3.bucket}/${PREFIX}`))).toBe(true);
    for (const k of survivors) expect(s3.objects.has(k)).toBe(true);
    expect(s3.objects.has(PROBE)).toBe(false);
    // O envio saiu com o SHA-256 no corpo assinado e no checksum do servidor.
    const put = sent.find((r) => r.method === 'PUT')!;
    expect(put.headers['x-amz-checksum-sha256']).toBeTruthy();
    expect(put.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('falha de verdade (AccessDenied): saída legível, sem segredo, sem chave de acesso e sem o endereço S3', async () => {
    s3.next.push({ status: 403, body: xmlError('AccessDenied') });
    const report = await runSmoke({ remote: new R2StorageProvider(settings(), { timeoutMs: 2000 }), fetchPublic: publicFromS3, ...FIXED });
    expect(report.failure).toMatchObject({ step: 'access', cause: 'access_denied', group: 'autenticação' });
    const redact = makeRedactor(settings());
    const text = formatSmokeReport(report, 'img.exemplo.test')
      .map((l) => redact(l))
      .join('\n');
    for (const forbidden of [SECRET, ACCESS, s3.endpoint, '127.0.0.1', 'Signature=', 'Credential=']) expect(text).not.toContain(forbidden);
    expect(text).toContain('RESULTADO: FAIL');
    expect(text).toContain('autenticação');
  });

  it('o redator troca chave, segredo e endereço em QUALQUER texto', () => {
    const redact = makeRedactor(settings());
    const out = redact(`a ${SECRET} b ${ACCESS} c ${s3.endpoint}/bucket d 127.0.0.1`);
    for (const forbidden of [SECRET, ACCESS, s3.endpoint, '127.0.0.1']) expect(out).not.toContain(forbidden);
    expect(out).toContain('***');
  });
});

describe('pré-condições: sem R2 completo o smoke RECUSA, sem tocar em nada', () => {
  const OK = { R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'meus-perfumes-teste', R2_PUBLIC_BASE_URL: 'https://img.exemplo.test' };

  it.each([
    ['nada configurado', {}, 'o R2 não está configurado'],
    ['configuração parcial', { R2_BUCKET: 'meus-perfumes-teste', R2_ACCESS_KEY_ID: 'k' }, 'incompleta'],
    ['valor inválido', { ...OK, R2_BUCKET: 'Bucket_Invalido' }, 'valores inválidos'],
    ['URL pública igual ao endpoint S3', { ...OK, R2_PUBLIC_BASE_URL: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com' }, 'valores inválidos'],
  ])('%s → recusa e explica', (_label, env, why) => {
    const plan = planSmoke(diagnoseR2(env));
    expect(plan.run).toBe(false);
    if (plan.run) return;
    const text = plan.lines.join('\n');
    expect(text).toContain('RECUSADO');
    expect(text).toContain(why);
    expect(text).toContain('Nada foi enviado nem consultado');
    expect(text).toContain('MEDIA_BACKEND não precisa mudar');
    for (const forbidden of ['meus-perfumes-teste', 'Bucket_Invalido', 'img.exemplo.test', '0123456789abcdef']) expect(text).not.toContain(forbidden);
  });

  it('R2 completo e válido → pode rodar (com MEDIA_BACKEND=local também: o smoke vem ANTES da virada)', () => {
    expect(planSmoke(diagnoseR2(OK))).toEqual({ run: true });
  });

  it('a CLI consulta o portão ANTES de criar o cliente do R2 e de chamar o smoke', () => {
    const source = readFileSync('apps/server/src/media/smoke-cli.ts', 'utf8');
    const gate = source.indexOf('planSmoke(');
    expect(gate).toBeGreaterThan(0);
    expect(source.indexOf('new R2StorageProvider(')).toBeGreaterThan(gate);
    expect(source.indexOf('runSmoke(')).toBeGreaterThan(gate);
  });
});
