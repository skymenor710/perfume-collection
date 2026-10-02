/**
 * Porta de armazenamento de arquivos (fotos dos frascos).
 *
 * `LocalStorageProvider` (pasta data/media deste computador) e `R2StorageProvider` (Cloudflare R2, FASE 3, chaves
 * por conteúdo "p/<sha256>.<formato>" — storage/keys.ts) cumprem o mesmo contrato: o resto do servidor não muda.
 *
 * Chaves são caminhos relativos simples ("abc-lg.webp", "p/<sha256>.webp"): sem "..", sem barra inicial,
 * só letras, números, ".", "_" e "-". Nada vindo de loja vira chave — quem grava gera o nome.
 *
 * Erros: "não existe" é resposta (null/false); "não deu para saber" (rede, timeout, 5xx, resposta estranha) é
 * `StorageUnavailableError` — nunca vira "não existe", para uma falha não parecer migração incompleta nem o contrário.
 */

import type { StorageFailure } from './failure';

export interface PutOptions {
  contentType: string;
  /** Cache-Control a ser servido com o objeto (R2/CDN). O provedor local ignora. */
  cacheControl?: string;
  /**
   * SHA-256 (hex) que o conteúdo TEM de ter. O provedor recusa (`ChecksumMismatchError`) se não bater — no R2 a
   * conferência é feita também pelo servidor (x-amz-checksum-sha256), então byte corrompido no caminho não grava.
   */
  sha256?: string;
}

/**
 * O armazenamento não respondeu como devia. A mensagem nunca carrega credencial nem URL assinada. `code` diz a causa
 * quando ela pôde ser determinada (storage/failure.ts); 'unexpected' quando não — nunca um palpite.
 */
export class StorageUnavailableError extends Error {
  constructor(
    readonly op: string,
    readonly key: string | null,
    readonly detail: string,
    readonly code: StorageFailure = 'unexpected',
  ) {
    super(`Armazenamento indisponível (${op}${key ? ` ${key}` : ''}): ${detail}`);
    this.name = 'StorageUnavailableError';
  }
}

/** O conteúdo não tem o SHA-256 esperado: nada foi (ou deve ser) considerado gravado. */
export class ChecksumMismatchError extends Error {
  constructor(
    readonly key: string,
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(`SHA-256 não confere em ${key}: esperado ${expected.slice(0, 12)}…, veio ${actual ? `${actual.slice(0, 12)}…` : 'desconhecido'}`);
    this.name = 'ChecksumMismatchError';
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
  size: number;
  modifiedAt: Date;
}

export interface StoredEntry {
  key: string;
  size: number;
  modifiedAt: Date;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  /** Nulo quando não existe (ou a chave é inválida). */
  get(key: string): Promise<StoredObject | null>;
  /** true se apagou; false se não existia. */
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  /**
   * Endereço público do objeto. Local: a referência relativa que o app já usa ("media/<chave>"), servida pelo
   * próprio servidor. R2: URL absoluta da CDN.
   */
  publicUrl(key: string): string;
  /**
   * Os objetos cuja chave começa com `prefix` (semântica de prefixo do S3: "p/" ou "healthcheck/ab12/"; um pedaço de
   * nome também vale). Sem prefixo, todos — para a limpeza de órfãos do disco local. Quem audita o R2 passa SEMPRE um
   * prefixo: nunca lista o bucket inteiro sem precisar.
   */
  list(prefix?: string): Promise<StoredEntry[]>;
}

/**
 * Armazenamento remoto (R2): além do contrato comum, `checkAccess()` prova endereço + credenciais + bucket + permissão de
 * listar com UMA listagem mínima (no máximo 1 objeto, sob "healthcheck/"). É o que separa "bucket errado" de "objeto
 * ausente" — um 404 de HEAD/GET sozinho não separa (storage/failure.ts). Lança `StorageUnavailableError` com a causa.
 */
export interface RemoteStorage extends StorageProvider {
  checkAccess(): Promise<void>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class InvalidKeyError extends Error {
  constructor(key: string) {
    super(`Chave de armazenamento inválida: ${JSON.stringify(key.slice(0, 80))}`);
  }
}

export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= 200 && KEY.test(key) && !key.split('/').some((part) => part === '..' || part === '.');
}

export function assertValidKey(key: string): string {
  if (!isValidKey(key)) throw new InvalidKeyError(key);
  return key;
}

/** Prefixo de listagem: as mesmas regras de uma chave, mas pode terminar em "/" (ou no meio de um nome). */
export function isValidPrefix(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/?$/.test(prefix) && !prefix.split('/').some((part) => part === '..' || part === '.');
}

export function assertValidPrefix(prefix: string | undefined): string | undefined {
  if (prefix === undefined) return undefined;
  if (!isValidPrefix(prefix)) throw new InvalidKeyError(prefix);
  return prefix;
}

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  avif: 'image/avif',
  gif: 'image/gif',
  json: 'application/json',
};

export function contentTypeOf(key: string): string {
  return TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
