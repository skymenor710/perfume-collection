import { safeFetch } from './safe-fetch';

/**
 * Boas maneiras com os sites das lojas: uma página por pedido da pessoa, nunca rastreamento.
 * - robots.txt é lido (com cache de 1 h) e um caminho proibido para "*" não é aberto;
 * - no máximo uma requisição a cada 1,5 s por domínio;
 * - sem cookies, sem repetir tentativa em página de bloqueio.
 */

interface Rules {
  allow: string[];
  disallow: string[];
  fetchedAt: number;
}

const ROBOTS_TTL = 60 * 60_000;
const robotsCache = new Map<string, Rules>();

/** Lê só o grupo `User-agent: *` (o app não tem nome próprio que um site pudesse citar). */
export function parseRobots(text: string): Omit<Rules, 'fetchedAt'> {
  const allow: string[] = [];
  const disallow: string[] = [];
  let agents: string[] = [];
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) agents = [];
      agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!agents.includes('*')) continue;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
  }
  return { allow, disallow };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Regra mais longa vence; empate favorece Allow (como o Google interpreta). */
export function robotsAllows(rules: Omit<Rules, 'fetchedAt'>, pathWithQuery: string): boolean {
  let best = { length: -1, allow: true };
  for (const p of rules.disallow) if (patternToRegex(p).test(pathWithQuery) && p.length > best.length) best = { length: p.length, allow: false };
  for (const p of rules.allow) if (patternToRegex(p).test(pathWithQuery) && p.length >= best.length) best = { length: p.length, allow: true };
  return best.allow;
}

export async function isAllowedByRobots(url: URL): Promise<boolean> {
  const origin = url.origin;
  let rules = robotsCache.get(origin);
  if (!rules || Date.now() - rules.fetchedAt > ROBOTS_TTL) {
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 6000, maxBytes: 512 * 1024, allowErrorStatus: true });
      rules = { ...(res.status < 400 ? parseRobots(res.body) : { allow: [], disallow: [] }), fetchedAt: Date.now() };
    } catch {
      // Sem robots.txt acessível: vale a regra geral da web (permitido).
      rules = { allow: [], disallow: [], fetchedAt: Date.now() };
    }
    robotsCache.set(origin, rules);
  }
  return robotsAllows(rules, `${url.pathname}${url.search}`);
}

const lastHit = new Map<string, number>();
const MIN_INTERVAL = 1500;

export async function waitTurn(host: string) {
  const now = Date.now();
  const next = Math.max(now, (lastHit.get(host) ?? 0) + MIN_INTERVAL);
  lastHit.set(host, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}
