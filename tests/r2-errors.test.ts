import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyNetworkError, classifyResponse, FAILURE_TEXT, s3ErrorCode, type StorageFailure } from '../apps/server/src/storage/failure';
import { R2StorageProvider } from '../apps/server/src/storage/r2';
import { InvalidKeyError, StorageUnavailableError } from '../apps/server/src/storage/types';
import { startFakeS3, xmlError, type FakeS3 } from './helpers/fake-s3-server';

/**
 * FASE 3.1 (hardening sem credenciais) — o R2 diferencia POR QUE falhou: objeto ausente × bucket inexistente ×
 * acesso negado × assinatura × endereço errado × rede × tempo × servidor. Servidor S3 falso em 127.0.0.1; nenhuma
 * chamada sai da máquina. O que o R2 real responde em cada caso só a FASE 3.1 real confirma (documentado em failure.ts).
 */

const SECRET = 'segredo-de-teste-nao-real';
const ACCESS = 'chave-de-teste-nao-real';
const key = (n: string) => `p/${n.repeat(64).slice(0, 64)}.webp`;

let s3: FakeS3;
let r2: R2StorageProvider;
const captured: unknown[] = [];
const settings = (over: Partial<{ endpoint: string; bucket: string }> = {}) => ({ endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: ACCESS, secretAccessKey: SECRET, publicBaseUrl: 'https://img.exemplo.test', ...over });

/** Espera um StorageUnavailableError com esta causa (e guarda o erro para a checagem de segredos). */
async function expectCause(promise: Promise<unknown>, cause: StorageFailure, detail?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  captured.push(error);
  expect(error).toBeInstanceOf(StorageUnavailableError);
  expect((error as StorageUnavailableError).code).toBe(cause);
  if (detail) expect((error as Error).message).toMatch(detail);
}

beforeAll(async () => {
  s3 = await startFakeS3();
  r2 = new R2StorageProvider(settings(), { timeoutMs: 400, pageSize: 2 });
});
afterAll(() => s3.close());

describe('GET: só NoSuchKey (ou corpo vazio) é "objeto ausente"', () => {
  it('NoSuchKey de verdade → null', async () => {
    expect(await r2.get(key('a'))).toBeNull();
  });

  it('404 com corpo vazio → null (não há mais o que saber; documentado)', async () => {
    s3.next.push({ status: 404, body: '' });
    expect(await r2.get(key('a'))).toBeNull();
  });

  it('404 NoSuchBucket → erro no_such_bucket, NÃO "ausente"', async () => {
    s3.next.push({ status: 404, body: xmlError('NoSuchBucket') });
    await expectCause(r2.get(key('a')), 'no_such_bucket', /HTTP 404 \(NoSuchBucket\)/);
  });

  it('404 com página HTML (endereço que não é S3) → erro endpoint', async () => {
    s3.next.push({ status: 404, body: '<html><body>Not Found</body></html>', contentType: 'text/html' });
    await expectCause(r2.get(key('a')), 'endpoint');
  });

  it('404 com um código S3 que não é NoSuchKey → erro unexpected (nunca "ausente")', async () => {
    s3.next.push({ status: 404, body: xmlError('NoSuchVersion') });
    await expectCause(r2.get(key('a')), 'unexpected', /NoSuchVersion/);
  });
});

describe('bucket errado: HEAD não distingue, checkAccess() distingue', () => {
  it('com o bucket inexistente, exists() diz false (HEAD não tem corpo), mas checkAccess/list/put/get dizem NoSuchBucket', async () => {
    const wrong = new R2StorageProvider(settings({ bucket: 'bucket-que-nao-existe' }), { timeoutMs: 400 });
    expect(await wrong.exists(key('b'))).toBe(false); // a limitação documentada: não dá para saber só pelo HEAD
    await expectCause(wrong.checkAccess(), 'no_such_bucket');
    await expectCause(wrong.list('healthcheck/'), 'no_such_bucket');
    await expectCause(wrong.put(key('b'), Buffer.from('x'), { contentType: 'text/plain' }), 'no_such_bucket');
    await expectCause(wrong.get(key('b')), 'no_such_bucket');
    expect(s3.objects.size).toBe(0);
  });

  it('checkAccess() com o bucket certo passa e lista no máximo 1 objeto, só sob healthcheck/', async () => {
    const before = s3.requests.length;
    await r2.checkAccess();
    const req = s3.requests.slice(before);
    expect(req).toHaveLength(1);
    expect(req[0]!.query.get('prefix')).toBe('healthcheck/');
    expect(req[0]!.query.get('max-keys')).toBe('1');
  });
});

describe('checkAccess(): cada causa aparece como ela é', () => {
  it.each<[string, Parameters<FakeS3['next']['push']>[0], StorageFailure]>([
    ['403 AccessDenied', { status: 403, body: xmlError('AccessDenied') }, 'access_denied'],
    ['403 SignatureDoesNotMatch', { status: 403, body: xmlError('SignatureDoesNotMatch') }, 'signature'],
    ['403 InvalidAccessKeyId', { status: 403, body: xmlError('InvalidAccessKeyId') }, 'invalid_credentials'],
    ['403 RequestTimeTooSkewed', { status: 403, body: xmlError('RequestTimeTooSkewed') }, 'clock_skew'],
    ['301 redirecionamento (endpoint/jurisdição errada)', { status: 301, redirect: 'https://outro.exemplo.test/x' }, 'endpoint'],
    ['200 com página HTML', { status: 200, body: '<html>não sou S3</html>', contentType: 'text/html' }, 'endpoint'],
    ['PermanentRedirect', { status: 301, body: xmlError('PermanentRedirect') }, 'endpoint'],
    ['500', { status: 500 }, 'server'],
    ['503 ServiceUnavailable', { status: 503, body: xmlError('ServiceUnavailable') }, 'server'],
    ['429 SlowDown', { status: 429, body: xmlError('SlowDown') }, 'throttled'],
    ['sem resposta no tempo limite', { delayMs: 1500 }, 'timeout'],
  ])('%s → %s', async (_label, fault, cause) => {
    s3.next.push(fault);
    await expectCause(r2.checkAccess(), cause);
  });

  it('403 sem corpo (HEAD) → forbidden: não dá para dizer se é permissão ou assinatura', async () => {
    s3.next.push({ status: 403 });
    await expectCause(r2.exists(key('c')), 'forbidden', /HTTP 403/);
  });

  it('o status HTTP continua na mensagem de toda resposta inesperada (contrato dos logs)', async () => {
    s3.next.push({ status: 500 });
    await expectCause(r2.get(key('c')), 'server', /HTTP 500/);
    s3.next.push({ status: 503 });
    await expectCause(r2.exists(key('c')), 'server', /HTTP 503/);
    s3.next.push({ status: 403 });
    await expectCause(r2.put(key('c'), Buffer.from('x'), { contentType: 'text/plain' }), 'access_denied', /HTTP 403/);
  });

  it('conexão recusada (servidor parado) → connection, sem mostrar o endereço', async () => {
    const dead = await startFakeS3();
    const endpoint = dead.endpoint;
    await dead.close();
    const offline = new R2StorageProvider(settings({ endpoint }), { timeoutMs: 2000 });
    await expectCause(offline.checkAccess(), 'connection');
    expect((captured.at(-1) as Error).message).not.toContain(endpoint);
  });

  it('put recusado com AccessDenied: nada fica gravado; delete idem', async () => {
    const k = key('d');
    s3.next.push({ status: 403, body: xmlError('AccessDenied') });
    await expectCause(r2.put(k, Buffer.from('x'), { contentType: 'text/plain' }), 'access_denied');
    expect(s3.objects.has(k)).toBe(false);
    await r2.put(k, Buffer.from('x'), { contentType: 'text/plain' });
    s3.next.push({ status: 200 }); // o HEAD do exists
    s3.next.push({ status: 403, body: xmlError('AccessDenied') });
    await expectCause(r2.delete(k), 'access_denied');
    expect(s3.objects.has(k)).toBe(true);
  });
});

describe('classificadores (puros)', () => {
  it.each<[string, StorageFailure]>([
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ECONNREFUSED', 'connection'],
    ['ECONNRESET', 'connection'],
    ['ETIMEDOUT', 'timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['CERT_HAS_EXPIRED', 'tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
    ['ALGO_DESCONHECIDO', 'network'],
  ])('falha de sistema %s → %s', (code, cause) => {
    const error = Object.assign(new TypeError('fetch failed'), { cause: { code } });
    expect(classifyNetworkError(error)).toBe(cause);
  });

  it('TimeoutError/AbortError → timeout; erro sem código → network', () => {
    expect(classifyNetworkError(new DOMException('x', 'TimeoutError'))).toBe('timeout');
    expect(classifyNetworkError(new DOMException('x', 'AbortError'))).toBe('timeout');
    expect(classifyNetworkError(new Error('qualquer coisa'))).toBe('network');
    expect(classifyNetworkError(undefined)).toBe('network');
  });

  it('status + código S3 → causa; código S3 só aceita letras (nada de texto livre do servidor)', () => {
    expect(classifyResponse(404, 'NoSuchBucket')).toBe('no_such_bucket');
    expect(classifyResponse(403, null, 'corpo')).toBe('access_denied');
    expect(classifyResponse(403, null, '')).toBe('forbidden');
    expect(classifyResponse(302, null)).toBe('endpoint');
    expect(classifyResponse(502, null, '<html>bad gateway</html>')).toBe('endpoint');
    expect(classifyResponse(418, null)).toBe('unexpected');
    expect(s3ErrorCode('<Error><Code>NoSuchKey</Code><Message>segredo 123</Message></Error>')).toBe('NoSuchKey');
    expect(s3ErrorCode('<Error><Code>../../etc</Code></Error>')).toBeNull();
    expect(s3ErrorCode('sem xml')).toBeNull();
  });

  it('toda causa tem frase fixa, sem endereço, chave ou segredo', () => {
    for (const text of Object.values(FAILURE_TEXT)) expect(text).not.toMatch(/https?:|secret|Credential=|Signature=/i);
  });
});

describe('list(prefix)', () => {
  it('manda o prefixo ao servidor, pagina dentro dele e não mistura outros prefixos', async () => {
    for (const k of ['lista/a/1.txt', 'lista/a/2.txt', 'lista/a/3.txt', 'lista/b/1.txt', 'outra/1.txt']) await r2.put(k, Buffer.from(k), { contentType: 'text/plain' });
    const before = s3.requests.length;
    const a = await r2.list('lista/a/');
    expect(a.map((e) => e.key).sort()).toEqual(['lista/a/1.txt', 'lista/a/2.txt', 'lista/a/3.txt']);
    const listRequests = s3.requests.slice(before).filter((r) => r.query.get('list-type') === '2');
    expect(listRequests).toHaveLength(2); // páginas de 2
    expect(listRequests.every((r) => r.query.get('prefix') === 'lista/a/')).toBe(true);
    expect((await r2.list('lista/')).map((e) => e.key)).toHaveLength(4);
    expect((await r2.list('lista/b/')).map((e) => e.key)).toEqual(['lista/b/1.txt']);
    expect(await r2.list('nao-existe/')).toEqual([]);
  });

  it('sem prefixo continua listando tudo (limpeza de órfãos), e não manda o parâmetro prefix', async () => {
    const before = s3.requests.length;
    expect((await r2.list()).length).toBeGreaterThanOrEqual(5);
    expect(s3.requests.slice(before).every((r) => !r.query.has('prefix'))).toBe(true);
  });

  it.each(['', '../x', '/absoluto', 'a//b', 'com espaço/', 'a/./b'])('prefixo inválido %j é recusado ANTES de qualquer pedido', async (prefix) => {
    const before = s3.requests.length;
    await expect(r2.list(prefix)).rejects.toBeInstanceOf(InvalidKeyError);
    expect(s3.requests.length).toBe(before);
  });
});

describe('nenhum erro carrega segredo, chave de acesso, assinatura nem o endereço S3', () => {
  it('em todos os erros capturados acima', () => {
    expect(captured.length).toBeGreaterThan(20);
    for (const error of captured) {
      const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}\n${JSON.stringify(error)}`;
      for (const forbidden of [SECRET, ACCESS, 'Signature=', 'Credential=', s3.endpoint, '127.0.0.1']) expect(text).not.toContain(forbidden);
    }
  });
});
