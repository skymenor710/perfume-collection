import { createHash } from 'node:crypto';
import { assertValidKey, ChecksumMismatchError, isValidKey, StorageUnavailableError, type PutOptions, type StorageProvider, type StoredEntry, type StoredObject } from '../../apps/server/src/storage/types';

/**
 * R2 falso, em memória, para os testes da FASE 3 (sem internet, sem Cloudflare). Cumpre o contrato StorageProvider
 * como o R2StorageProvider: confere o SHA-256 no put, distingue "não existe" (null/false) de "indisponível" (erro).
 *
 * Falhas sob encomenda (`fail(op, kind, vezes)`):
 *   unavailable  StorageUnavailableError (5xx / rede)
 *   timeout      StorageUnavailableError "sem resposta"
 *   drop         put responde OK mas o objeto não fica (upload "aceito" e perdido)
 *   truncate     put guarda só metade do conteúdo (upload interrompido)
 *   corrupt      get devolve um byte trocado
 *   missing      get/exists respondem "não existe" mesmo com o objeto lá
 * `latencyMs` com jitter embaralha a ordem das operações simultâneas (concorrência de verdade).
 */

type Op = 'put' | 'get' | 'exists' | 'delete' | 'list';
type Fault = 'unavailable' | 'timeout' | 'drop' | 'truncate' | 'corrupt' | 'missing';

interface FakeObject {
  body: Buffer;
  contentType: string;
  cacheControl: string | null;
  modifiedAt: Date;
}

export class FakeR2StorageProvider implements StorageProvider {
  readonly name = 'fake-r2';
  readonly objects = new Map<string, FakeObject>();
  readonly calls: Record<Op, number> = { put: 0, get: 0, exists: 0, delete: 0, list: 0 };
  private readonly faults: { op: Op; kind: Fault; times: number; key?: string }[] = [];
  latencyMs = 0;

  constructor(readonly publicBase = 'https://img.exemplo.test') {}

  fail(op: Op, kind: Fault, times = 1, key?: string): this {
    this.faults.push({ op, kind, times, key });
    return this;
  }

  private async enter(op: Op, key: string | null): Promise<Fault | null> {
    this.calls[op]++;
    if (this.latencyMs) await new Promise((r) => setTimeout(r, Math.random() * this.latencyMs));
    const i = this.faults.findIndex((f) => f.op === op && f.times > 0 && (!f.key || f.key === key));
    if (i < 0) return null;
    const fault = this.faults[i]!;
    fault.times--;
    if (fault.kind === 'unavailable') throw new StorageUnavailableError(op, key, 'resposta inesperada HTTP 503');
    if (fault.kind === 'timeout') throw new StorageUnavailableError(op, key, 'sem resposta em 20000 ms');
    return fault.kind;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    assertValidKey(key);
    const fault = await this.enter('put', key);
    const sha = createHash('sha256').update(body).digest('hex');
    if (options.sha256 && options.sha256 !== sha) throw new ChecksumMismatchError(key, options.sha256, sha);
    if (fault === 'drop') return;
    const stored = fault === 'truncate' ? Buffer.from(body.subarray(0, Math.floor(body.length / 2))) : Buffer.from(body);
    this.objects.set(key, { body: stored, contentType: options.contentType, cacheControl: options.cacheControl ?? null, modifiedAt: new Date() });
  }

  async get(key: string): Promise<StoredObject | null> {
    if (!isValidKey(key)) return null;
    const fault = await this.enter('get', key);
    const hit = this.objects.get(key);
    if (!hit || fault === 'missing') return null;
    const body = Buffer.from(hit.body);
    if (fault === 'corrupt' && body.length) body[body.length - 1] = body[body.length - 1]! ^ 0xff;
    return { body, contentType: hit.contentType, size: body.length, modifiedAt: hit.modifiedAt };
  }

  async exists(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false;
    const fault = await this.enter('exists', key);
    return fault === 'missing' ? false : this.objects.has(key);
  }

  async delete(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false;
    await this.enter('delete', key);
    return this.objects.delete(key);
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${assertValidKey(key)}`;
  }

  async list(): Promise<StoredEntry[]> {
    await this.enter('list', null);
    return [...this.objects.entries()].map(([key, o]) => ({ key, size: o.body.length, modifiedAt: o.modifiedAt }));
  }
}
