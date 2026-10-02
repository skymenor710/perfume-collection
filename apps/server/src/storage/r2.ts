import { AwsClient } from 'aws4fetch';
import type { R2Settings } from '../config';
import { classifyNetworkError, classifyResponse, FAILURE_TEXT, s3ErrorCode } from './failure';
import { sha256Hex } from './keys';
import { assertValidKey, assertValidPrefix, ChecksumMismatchError, isValidKey, StorageUnavailableError, type PutOptions, type RemoteStorage, type StoredEntry, type StoredObject } from './types';

/**
 * Cloudflare R2 pela API S3 (assinatura AWS SigV4, via aws4fetch — sem SDK). Implementa o MESMO contrato do
 * armazenamento local: nada de S3/R2 fora deste arquivo.
 *
 * Garantias:
 *   - gravação com o SHA-256 no corpo assinado (x-amz-content-sha256) E na checagem do servidor
 *     (x-amz-checksum-sha256): conteúdo que chega diferente é recusado pelo R2, nada fica gravado;
 *   - 404 é "não existe" (null/false) SÓ quando não há indício de outra coisa; qualquer outra resposta inesperada
 *     (rede, timeout, 5xx, 3xx, corpo incompleto, XML estranho, bucket inexistente, acesso negado) é
 *     `StorageUnavailableError`, com a CAUSA em `code` (storage/failure.ts) — nunca confundida com "não existe";
 *   - erros e logs NUNCA carregam chave de acesso, segredo, cabeçalho de assinatura, URL assinada nem endereço;
 *   - sem novas tentativas escondidas: quem chama decide (a migração registra a falha e segue).
 *
 * O que um 404 NÃO diz (documentado, não adivinhado):
 *   - `get` tem corpo: NoSuchKey → null; NoSuchBucket → erro `no_such_bucket`; corpo vazio → null (não há como saber
 *     mais); página HTML → erro `endpoint`.
 *   - `exists` usa HEAD, que não tem corpo: 404 → false, sem saber se faltou o objeto ou o bucket. Por isso quem audita
 *     chama `checkAccess()` ANTES (uma listagem mínima, que tem corpo).
 *
 * `fetch` é injetável: os testes usam um servidor S3 falso local, sem internet (tests/helpers/fake-s3-server.ts).
 */

export interface R2Options {
  fetch?: (request: Request, init?: RequestInit) => Promise<Response>;
  /** Tempo máximo por pedido (padrão 20 s). */
  timeoutMs?: number;
  /** Tamanho da página do list (padrão 1000, o máximo do S3). */
  pageSize?: number;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!);
const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? null;
const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Prefixo da sonda de acesso: a mesma área que o smoke usa, sempre vazia de fotos. */
export const ACCESS_PROBE_PREFIX = 'healthcheck/';

export class R2StorageProvider implements RemoteStorage {
  readonly name = 'r2';
  private readonly client: AwsClient;
  private readonly bucketUrl: string;
  private readonly publicBase: string;
  private readonly send: (request: Request, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly pageSize: number;

  constructor(settings: R2Settings, options: R2Options = {}) {
    // O endereço S3 é privado (exige assinatura): nunca pode ser o endereço que o navegador recebe para uma foto.
    const publicOrigin = originOf(settings.publicBaseUrl);
    if (publicOrigin && publicOrigin === originOf(settings.endpoint)) throw new Error('O endereço público das fotos não pode ser o endereço S3 do R2 (privado).');
    // retries: 0 — o aws4fetch repetiria 5xx sozinho; aqui a decisão é de quem chama.
    this.client = new AwsClient({ accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, service: 's3', region: 'auto', retries: 0 });
    this.bucketUrl = `${settings.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(settings.bucket)}`;
    this.publicBase = settings.publicBaseUrl.replace(/\/+$/, '');
    this.send = options.fetch ?? ((request, init) => fetch(request, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.pageSize = options.pageSize ?? 1000;
  }

  private objectUrl(key: string): string {
    return `${this.bucketUrl}/${assertValidKey(key).split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Assina e envia. Falha de rede/timeout vira StorageUnavailableError com texto neutro (sem URL nem cabeçalhos). */
  private async request(op: string, key: string | null, url: string, init: RequestInit): Promise<Response> {
    let signed: Request;
    try {
      signed = await this.client.sign(url, init);
    } catch {
      throw new StorageUnavailableError(op, key, 'não foi possível assinar o pedido');
    }
    try {
      return await this.send(signed, { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'manual' });
    } catch (error) {
      const failure = classifyNetworkError(error);
      const detail = failure === 'timeout' ? `sem resposta em ${this.timeoutMs} ms` : failure === 'network' ? 'falha de rede' : `falha de rede (${FAILURE_TEXT[failure]})`;
      throw new StorageUnavailableError(op, key, detail, failure);
    }
  }

  /** O erro de uma resposta inesperada: status + código S3 (só letras) + causa em frase fixa. Nada do corpo além disso. */
  private failure(op: string, key: string | null, status: number, code: string | null, body: string): StorageUnavailableError {
    const cause = classifyResponse(status, code, body);
    const detail = `resposta inesperada HTTP ${status}${code ? ` (${code})` : ''}${cause === 'unexpected' ? '' : `: ${FAILURE_TEXT[cause]}`}`;
    return new StorageUnavailableError(op, key, detail, cause);
  }

  /** Lê o corpo (limitado) e monta o erro; HEAD não tem corpo (`hasBody: false`). */
  private async fail(op: string, key: string | null, res: Response, hasBody = true): Promise<StorageUnavailableError> {
    let text = '';
    if (hasBody) text = (await res.text().catch(() => '')).slice(0, 4096);
    else await res.body?.cancel().catch(() => {});
    return this.failure(op, key, res.status, s3ErrorCode(text), text);
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    const url = this.objectUrl(key);
    const sha = sha256Hex(body);
    if (options.sha256 && options.sha256 !== sha) throw new ChecksumMismatchError(key, options.sha256, sha);
    const headers: Record<string, string> = {
      'Content-Type': options.contentType,
      'X-Amz-Content-Sha256': sha,
      'X-Amz-Checksum-Sha256': Buffer.from(sha, 'hex').toString('base64'),
      'X-Amz-Meta-Sha256': sha,
    };
    if (options.cacheControl) headers['Cache-Control'] = options.cacheControl;
    const res = await this.request('put', key, url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (res.status === 200) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    // O servidor recusou o conteúdo pelo checksum: nada gravado.
    if (res.status === 400) {
      const text = (await res.text().catch(() => '')).slice(0, 4096);
      if (/BadDigest|XAmzContentSHA256Mismatch|InvalidDigest/i.test(text)) throw new ChecksumMismatchError(key, sha, null);
      throw this.failure('put', key, 400, s3ErrorCode(text), text);
    }
    throw await this.fail('put', key, res);
  }

  async get(key: string): Promise<StoredObject | null> {
    if (!isValidKey(key)) return null;
    const res = await this.request('get', key, this.objectUrl(key), { method: 'GET' });
    if (res.status === 404) {
      const text = (await res.text().catch(() => '')).slice(0, 4096);
      const code = s3ErrorCode(text);
      // NoSuchKey é "não existe". Corpo vazio também (não há mais o que saber). Bucket inexistente, página HTML ou
      // outro código NÃO são "objeto ausente": são erro, com a causa.
      if (code === 'NoSuchKey' || (!code && text.trim() === '')) return null;
      throw this.failure('get', key, 404, code, text);
    }
    if (res.status !== 200) throw await this.fail('get', key, res);
    let body: Buffer;
    try {
      body = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new StorageUnavailableError('get', key, 'corpo interrompido', 'network');
    }
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) !== body.length) throw new StorageUnavailableError('get', key, 'corpo incompleto', 'network');
    const modified = Date.parse(res.headers.get('last-modified') ?? '');
    return {
      body,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: body.length,
      modifiedAt: Number.isNaN(modified) ? new Date(0) : new Date(modified),
    };
  }

  /** HEAD: 404 → false, sem saber se faltou o objeto ou o bucket (HEAD não tem corpo). Veja `checkAccess()`. */
  async exists(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false;
    const res = await this.request('exists', key, this.objectUrl(key), { method: 'HEAD' });
    await res.body?.cancel().catch(() => {});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw this.failure('exists', key, res.status, null, '');
  }

  /** O S3 responde 204 mesmo sem objeto: confere antes para devolver "apagou?" de verdade. Só apaga UMA chave. */
  async delete(key: string): Promise<boolean> {
    if (!(await this.exists(key))) return false;
    const res = await this.request('delete', key, this.objectUrl(key), { method: 'DELETE' });
    if (res.status === 204 || res.status === 200) {
      await res.body?.cancel().catch(() => {});
      return true;
    }
    throw await this.fail('delete', key, res);
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${assertValidKey(key)}`;
  }

  async list(prefix?: string): Promise<StoredEntry[]> {
    assertValidPrefix(prefix);
    const out: StoredEntry[] = [];
    let token: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const params = new URLSearchParams({ 'list-type': '2', 'max-keys': String(this.pageSize) });
      if (prefix) params.set('prefix', prefix);
      if (token) params.set('continuation-token', token);
      const res = await this.request('list', null, `${this.bucketUrl}?${params}`, { method: 'GET' });
      if (res.status !== 200) throw await this.fail('list', null, res);
      const xml = await res.text().catch(() => '');
      if (!/<ListBucketResult[\s>]/.test(xml)) throw new StorageUnavailableError('list', null, 'resposta que não é uma listagem S3', 'endpoint');
      for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = decodeXml(tag(block!, 'Key') ?? '');
        const size = Number(tag(block!, 'Size'));
        const modified = Date.parse(tag(block!, 'LastModified') ?? '');
        if (!isValidKey(key) || !Number.isFinite(size)) continue;
        out.push({ key, size, modifiedAt: Number.isNaN(modified) ? new Date(0) : new Date(modified) });
      }
      if (tag(xml, 'IsTruncated') !== 'true') return out;
      token = decodeXml(tag(xml, 'NextContinuationToken') ?? '');
      if (!token) throw new StorageUnavailableError('list', null, 'listagem truncada sem continuação', 'unexpected');
    }
    throw new StorageUnavailableError('list', null, 'listagem sem fim', 'unexpected');
  }

  /**
   * Prova endereço + credenciais + bucket + permissão de listar com UMA listagem de no máximo 1 objeto sob
   * "healthcheck/" (nunca o bucket inteiro). Tem corpo: separa bucket inexistente, acesso negado, assinatura recusada e
   * endereço que não é S3 — o que HEAD/GET de um objeto sozinhos não separam.
   */
  async checkAccess(): Promise<void> {
    const params = new URLSearchParams({ 'list-type': '2', 'max-keys': '1', prefix: ACCESS_PROBE_PREFIX });
    const res = await this.request('access', null, `${this.bucketUrl}?${params}`, { method: 'GET' });
    if (res.status !== 200) throw await this.fail('access', null, res);
    const xml = await res.text().catch(() => '');
    if (!/<ListBucketResult[\s>]/.test(xml)) throw new StorageUnavailableError('access', null, 'resposta que não é uma listagem S3', 'endpoint');
  }
}
