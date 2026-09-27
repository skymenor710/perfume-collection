/**
 * Porta de armazenamento de arquivos (fotos dos frascos).
 *
 * Hoje: `LocalStorageProvider` (pasta data/media deste computador). FASE 2: `R2StorageProvider` (Cloudflare R2,
 * chaves por conteúdo, servido pelo subdomínio img.) cumprindo o mesmo contrato — o resto do servidor não muda.
 *
 * Chaves são caminhos relativos simples ("abc-lg.webp", "bottles/ab/abcd.webp"): sem "..", sem barra inicial,
 * só letras, números, ".", "_" e "-". Nada vindo de loja vira chave — quem grava gera o nome.
 */

export interface PutOptions {
  contentType: string;
  /** Cache-Control a ser servido com o objeto (R2/CDN). O provedor local ignora. */
  cacheControl?: string;
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
  /** Todos os objetos (para a limpeza de órfãos). */
  list(): Promise<StoredEntry[]>;
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
