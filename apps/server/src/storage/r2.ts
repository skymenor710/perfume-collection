import { AwsClient } from 'aws4fetch';
import type { R2Settings } from '../config';
import { sha256Hex } from './keys';
import { assertValidKey, ChecksumMismatchError, isValidKey, StorageUnavailableError, type PutOptions, type StorageProvider, type StoredEntry, type StoredObject } from './types';

/**
 * Cloudflare R2 pela API S3 (assinatura AWS SigV4, via aws4fetch — sem SDK). Implementa o MESMO contrato do
 * armazenamento local: nada de S3/R2 fora deste arquivo.
 *
 * Garantias:
 *   - gravação com o SHA-256 no corpo assinado (x-amz-content-sha256) E na checagem do servidor
 *     (x-amz-checksum-sha256): conteúdo que chega diferente é recusado pelo R2, nada fica gravado;
 *   - 404 é "não existe" (null/false); qualquer outra coisa inesperada (rede, timeout, 5xx, 3xx, corpo incompleto,
 *     XML estranho) é `StorageUnavailableError` — nunca confundida com "não existe";
 *   - erros e logs NUNCA carregam chave de acesso, segredo, cabeçalho de assinatura ou URL assinada;
 *   - sem novas tentativas escondidas: quem chama decide (a migração registra a falha e segue).
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

export class R2StorageProvider implements StorageProvider {
  readonly name = 'r2';
  private readonly client: AwsClient;
  private readonly bucketUrl: string;
  private readonly publicBase: string;
  private readonly send: (request: Request, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly pageSize: number;

  constructor(settings: R2Settings, options: R2Options = {}) {
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
    const signed = await this.client.sign(url, init);
    try {
      return await this.send(signed, { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'manual' });
    } catch (error) {
      const name = (error as Error)?.name;
      throw new StorageUnavailableError(op, key, name === 'TimeoutError' || name === 'AbortError' ? `sem resposta em ${this.timeoutMs} ms` : 'falha de rede');
    }
  }

  /** Descarta o corpo (libera a conexão) e devolve o erro neutro. */
  private async unexpected(op: string, key: string | null, res: Response): Promise<StorageUnavailableError> {
    await res.body?.cancel().catch(() => {});
    return new StorageUnavailableError(op, key, `resposta inesperada HTTP ${res.status}`);
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
      const text = await res.text().catch(() => '');
      if (/BadDigest|XAmzContentSHA256Mismatch|InvalidDigest/i.test(text)) throw new ChecksumMismatchError(key, sha, null);
      throw new StorageUnavailableError('put', key, 'resposta inesperada HTTP 400');
    }
    throw await this.unexpected('put', key, res);
  }

  async get(key: string): Promise<StoredObject | null> {
    if (!isValidKey(key)) return null;
    const res = await this.request('get', key, this.objectUrl(key), { method: 'GET' });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (res.status !== 200) throw await this.unexpected('get', key, res);
    let body: Buffer;
    try {
      body = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new StorageUnavailableError('get', key, 'corpo interrompido');
    }
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) !== body.length) throw new StorageUnavailableError('get', key, 'corpo incompleto');
    const modified = Date.parse(res.headers.get('last-modified') ?? '');
    return {
      body,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: body.length,
      modifiedAt: Number.isNaN(modified) ? new Date(0) : new Date(modified),
    };
  }

  async exists(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false;
    const res = await this.request('exists', key, this.objectUrl(key), { method: 'HEAD' });
    await res.body?.cancel().catch(() => {});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new StorageUnavailableError('exists', key, `resposta inesperada HTTP ${res.status}`);
  }

  /** O S3 responde 204 mesmo sem objeto: confere antes para devolver "apagou?" de verdade. */
  async delete(key: string): Promise<boolean> {
    if (!(await this.exists(key))) return false;
    const res = await this.request('delete', key, this.objectUrl(key), { method: 'DELETE' });
    await res.body?.cancel().catch(() => {});
    if (res.status === 204 || res.status === 200) return true;
    throw new StorageUnavailableError('delete', key, `resposta inesperada HTTP ${res.status}`);
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${assertValidKey(key)}`;
  }

  async list(): Promise<StoredEntry[]> {
    const out: StoredEntry[] = [];
    let token: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const params = new URLSearchParams({ 'list-type': '2', 'max-keys': String(this.pageSize) });
      if (token) params.set('continuation-token', token);
      const res = await this.request('list', null, `${this.bucketUrl}?${params}`, { method: 'GET' });
      if (res.status !== 200) throw await this.unexpected('list', null, res);
      const xml = await res.text().catch(() => '');
      if (!/<ListBucketResult[\s>]/.test(xml)) throw new StorageUnavailableError('list', null, 'resposta que não é uma listagem S3');
      for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = decodeXml(tag(block!, 'Key') ?? '');
        const size = Number(tag(block!, 'Size'));
        const modified = Date.parse(tag(block!, 'LastModified') ?? '');
        if (!isValidKey(key) || !Number.isFinite(size)) continue;
        out.push({ key, size, modifiedAt: Number.isNaN(modified) ? new Date(0) : new Date(modified) });
      }
      if (tag(xml, 'IsTruncated') !== 'true') return out;
      token = decodeXml(tag(xml, 'NextContinuationToken') ?? '');
      if (!token) throw new StorageUnavailableError('list', null, 'listagem truncada sem continuação');
    }
    throw new StorageUnavailableError('list', null, 'listagem sem fim');
  }
}
