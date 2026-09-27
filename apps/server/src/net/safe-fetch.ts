import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export type FetchErrorCode =
  | 'invalid_url'
  | 'private_address'
  | 'timeout'
  | 'network'
  | 'too_large'
  | 'too_many_redirects'
  | 'unsupported_content'
  | 'http_error';

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: 'html' | 'json' | 'image';
  /** Aceita 4xx/5xx e devolve a página (útil para detectar bloqueio). */
  allowErrorStatus?: boolean;
}

/** Endereços que nunca podem ser buscados a partir do servidor (SSRF). */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    if (lower.startsWith('::ffff:')) return true;
    return /^(?:f[cd]|fe[89ab]|ff)/.test(lower) || lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8');
  }
  return true;
}

/** Resolve o DNS e recusa a conexão se qualquer endereço for interno — também contra DNS rebinding. */
const guardedLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses as unknown as dns.LookupAddress[];
    if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
      const blocked = Object.assign(new Error('Endereço interno bloqueado'), { code: 'EPRIVATE' });
      return callback(blocked);
    }
    if (options.all) return callback(null, list);
    const first = list[0] as dns.LookupAddress;
    return callback(null, first.address, first.family);
  });
}) as unknown as typeof dns.lookup;

/**
 * Identificação honesta: o leitor se apresenta como o app, não como um navegador. Quem respeita robots.txt e termos
 * de uso não se disfarça — e site que não quer ser lido por robôs tem o direito de recusar (a pesquisa segue por
 * outras fontes). Só ASCII: cabeçalho HTTP não aceita acento.
 */
export const USER_AGENT = 'MeusPerfumes/1.0 (personal perfume collection; polite reader; respects robots.txt)';

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError('invalid_url', 'URL inválida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError('invalid_url', 'Protocolo não suportado');
  if (url.username || url.password) throw new FetchError('invalid_url', 'URL com credenciais');
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchError('invalid_url', 'Porta não suportada');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new FetchError('private_address', 'Endereço interno bloqueado');
  }
  return url;
}

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = head.subarray(0, 2048).toString('latin1');
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1]?.toLowerCase() ?? 'utf-8';
}

function decode(buffer: Buffer, contentType: string): string {
  const charset = charsetOf(contentType, buffer);
  try {
    return new TextDecoder(charset === 'gb2312' ? 'gbk' : charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(url: URL, options: Required<Pick<SafeFetchOptions, 'maxBytes' | 'accept'>>, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept === 'json' ? 'application/json,text/javascript;q=0.9,*/*;q=0.5' : options.accept === 'image' ? 'image/webp,image/avif,image/png,image/jpeg,image/*;q=0.8' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8,pt-BR;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }

        const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
        let stream: NodeJS.ReadableStream = response;
        if (encoding.includes('br')) stream = response.pipe(zlib.createBrotliDecompress());
        else if (encoding.includes('gzip')) stream = response.pipe(zlib.createGunzip());
        else if (encoding.includes('deflate')) stream = response.pipe(zlib.createInflate());

        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            request.destroy(new FetchError('too_large', 'Página grande demais'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
        stream.on('error', (error) => reject(error));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * GET seguro para páginas públicas de produto: só http/https em portas padrão,
 * nunca endereços internos, redirecionamentos revalidados, tempo e tamanho limitados.
 * Não envia cookies e não tenta contornar verificações anti-robô.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const accept = options.accept ?? 'html';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = validateUrl(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let response: RawResponse;
      try {
        response = await requestOnce(url, { maxBytes, accept }, controller.signal);
      } catch (error) {
        if (error instanceof FetchError) throw error;
        const code = (error as { code?: string }).code;
        if (controller.signal.aborted || code === 'ABORT_ERR') throw new FetchError('timeout', 'A página demorou demais');
        if (code === 'EPRIVATE') throw new FetchError('private_address', 'Endereço interno bloqueado');
        throw new FetchError('network', (error as Error).message ?? 'Falha de rede');
      }

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        url = validateUrl(new URL(response.headers.location, url).toString());
        continue;
      }

      const contentType = String(response.headers['content-type'] ?? '');
      const textual = /text\/|json|javascript|xml/i.test(contentType) || contentType === '';
      if (!textual) throw new FetchError('unsupported_content', 'O link não é uma página');
      if (response.status >= 400 && !options.allowErrorStatus) {
        throw new FetchError('http_error', `HTTP ${response.status}`, response.status);
      }
      return { url: url.toString(), status: response.status, contentType, body: decode(response.body, contentType) };
    }
    throw new FetchError('too_many_redirects', 'Redirecionamentos demais');
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchedImage {
  url: string;
  contentType: string;
  buffer: Buffer;
}

/** Baixa uma imagem pública com as mesmas proteções (SSRF, tempo, tamanho). Usada para a foto do frasco. */
export async function safeFetchImage(rawUrl: string, options: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    let url = validateUrl(rawUrl);
    for (let hop = 0; hop <= 4; hop++) {
      let response: RawResponse;
      try {
        response = await requestOnce(url, { maxBytes: options.maxBytes ?? 8 * 1024 * 1024, accept: 'image' }, controller.signal);
      } catch (error) {
        if (error instanceof FetchError) throw error;
        const code = (error as { code?: string }).code;
        if (controller.signal.aborted || code === 'ABORT_ERR') throw new FetchError('timeout', 'A imagem demorou demais');
        if (code === 'EPRIVATE') throw new FetchError('private_address', 'Endereço interno bloqueado');
        throw new FetchError('network', 'Falha de rede');
      }
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        url = validateUrl(new URL(response.headers.location, url).toString());
        continue;
      }
      const contentType = String(response.headers['content-type'] ?? '');
      if (response.status >= 400) throw new FetchError('http_error', `HTTP ${response.status}`, response.status);
      if (!/^image\/(png|jpe?g|webp|gif|avif)/i.test(contentType)) throw new FetchError('unsupported_content', 'Não é imagem');
      return { url: url.toString(), contentType, buffer: response.body };
    }
    throw new FetchError('too_many_redirects', 'Redirecionamentos demais');
  } finally {
    clearTimeout(timer);
  }
}
