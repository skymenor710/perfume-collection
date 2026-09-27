import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config';

/**
 * Quem pode usar a coleção deste computador:
 * - o próprio computador (localhost), sempre;
 * - outro aparelho da rede (o celular), depois de digitar o código de acesso uma vez.
 * O Host é conferido em toda requisição (contra DNS rebinding) e alterações exigem a mesma origem.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const COOKIE = 'perfumes_device';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const isLoopback = (req: IncomingMessage) => LOOPBACK.has(req.socket.remoteAddress ?? '');

export function localAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries ?? []) if (e.family === 'IPv4' && !e.internal) out.push(e.address);
  }
  return out;
}

export function checkHost(req: IncomingMessage) {
  const header = String(req.headers.host ?? '').toLowerCase();
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(header);
  const hostname = os.hostname().toLowerCase();
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', hostname, `${hostname}.local`, ...localAddresses()]);
  // Hospedado (PERFUMES_PUBLIC_ORIGIN): o domínio público também vale, na porta do proxy (80/443), não na do app.
  const pub = config.publicOrigin ? new URL(config.publicOrigin) : null;
  if (m && pub && m[1] === pub.hostname) return;
  if (!m || !allowed.has(m[1]) || Number(m[2] ?? 80) !== config.port) {
    throw new HttpError(421, 'wrong_host', 'Abra a coleção pelo endereço mostrado no computador.');
  }
}

export function checkSameOrigin(req: IncomingMessage) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host === req.headers.host) return;
    } catch {
      /* origem inválida cai no bloqueio */
    }
    throw new HttpError(403, 'forbidden_origin', 'Pedido bloqueado por segurança.');
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin', 'Pedido bloqueado por segurança.');
}

const devicesFile = () => path.join(config.dataDir, 'devices.json');
let devices: Set<string> | null = null;

function deviceSet(): Set<string> {
  if (!devices) {
    try {
      devices = new Set(existsSync(devicesFile()) ? (JSON.parse(readFileSync(devicesFile(), 'utf8')) as string[]) : []);
    } catch {
      devices = new Set();
    }
  }
  return devices;
}

function cookieToken(req: IncomingMessage): string | null {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isAuthorized(req: IncomingMessage): boolean {
  if (isLoopback(req)) return true;
  const token = cookieToken(req);
  return Boolean(token && /^[\w-]{20,100}$/.test(token) && deviceSet().has(token));
}

export function requireAuthorized(req: IncomingMessage) {
  if (!isAuthorized(req)) throw new HttpError(401, 'pairing_required', 'Digite o código de acesso que aparece no computador.');
}

const attempts = new Map<string, { count: number; since: number }>();

/** Libera este aparelho com o código. Seis tentativas a cada 15 minutos por endereço. */
export function pairDevice(req: IncomingMessage, code: string): string {
  const key = req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const a = attempts.get(key);
  const entry = a && now - a.since < 15 * 60_000 ? a : { count: 0, since: now };
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > 6) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Espere 15 minutos.');
  const expected = Buffer.from(config.accessCode);
  const typed = Buffer.from(code.replace(/[\s-]/g, '').toUpperCase());
  if (!expected.length || expected.length !== typed.length || !timingSafeEqual(expected, typed)) {
    throw new HttpError(403, 'wrong_code', 'Código incorreto. Confira o código mostrado no computador.');
  }
  const token = randomBytes(24).toString('base64url');
  deviceSet().add(token);
  writeFileSync(devicesFile(), JSON.stringify([...deviceSet()]), { mode: 0o600 });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}`;
}
