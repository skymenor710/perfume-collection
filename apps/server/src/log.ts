import pino from 'pino';
import { config } from './config';

/**
 * Logs estruturados (JSON, uma linha por evento) — prontos para um coletor em produção e legíveis com `jq`.
 *
 * O que NUNCA entra: senhas, tokens, cookies, cabeçalhos de autorização, o código de acesso do celular, chaves de
 * API e dados pessoais desnecessários. Duas camadas: `redact` apaga campos com nome sensível em qualquer evento,
 * e `safeUrl` corta query string e fragmento dos links (onde costumam viajar tokens e identificadores).
 */

export const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'cookie',
  '*.cookie',
  'authorization',
  '*.authorization',
  'accessCode',
  '*.accessCode',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]',
  'headers["x-subscription-token"]',
  'req.headers.cookie',
  'req.headers.authorization',
];

export function createLogger(options: { level?: string; destination?: pino.DestinationStream } = {}) {
  return pino(
    {
      level: options.level ?? config.logLevel,
      base: { service: 'perfumes-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[removido]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  );
}

export const log = createLogger();

/** Link reduzido a origem + caminho: sem usuário/senha, query string ou fragmento. Inválido vira "(link inválido)". */
export function safeUrl(raw: string | URL | null | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(String(raw));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(link inválido)';
  }
}

/** Caminho de uma requisição sem a query string ("/api/x?token=…" → "/api/x"). */
export function safePath(raw: string | undefined): string {
  return (raw ?? '').split('?')[0]?.slice(0, 200) ?? '';
}

export function hostOf(raw: string | URL | null | undefined): string {
  try {
    return raw ? new URL(String(raw)).host : '';
  } catch {
    return '';
  }
}

/**
 * Eventos com nome fixo — a lista é o contrato para painéis e alertas.
 * Campos livres continuam possíveis, mas passam pelo `redact`.
 */
export type LogEvent =
  | 'server.started'
  | 'server.error'
  | 'import.started'
  | 'import.completed'
  | 'import.failed'
  | 'import.cancelled'
  | 'import.choose_variant'
  | 'source.used'
  | 'source.error'
  | 'source.paused'
  | 'search.completed'
  | 'image.error'
  | 'image.worker_unavailable'
  | 'model.unavailable'
  | 'model.downloading'
  | 'media.gc'
  /** Com MEDIA_BACKEND=r2: foto pedida que não está validada no R2 (404, sem fallback). */
  | 'media.not_migrated'
  /** Com MEDIA_BACKEND=r2 e MEDIA_FALLBACK=local: foto servida da cópia local porque não está validada no R2. */
  | 'media.fallback'
  | 'library.migrated'
  | 'library.upgraded'
  | 'library.invalid_entries'
  | 'library.backup'
  | 'library.unreadable'
  | 'egress.throttled';

type Level = 'info' | 'warn' | 'error' | 'debug';

export function event(name: LogEvent, fields: Record<string, unknown> = {}, level: Level = 'info') {
  log[level]({ event: name, ...fields });
}
