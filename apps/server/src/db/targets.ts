/**
 * Descrição SEGURA de um endereço de banco e a checagem de que dois endereços são ambientes separados.
 * Nada aqui devolve usuário, senha, token ou a URL inteira — só o tipo, o host mascarado, se passa pelo pooler e o
 * nome do banco.
 *
 * No Neon, cada branch tem o próprio endpoint de computação ("ep-xxxx-yyyy"); a versão com pooler do mesmo endpoint
 * só acrescenta "-pooler" ao host. Dois endereços são o MESMO ambiente quando têm o mesmo endpoint (com ou sem
 * pooler) e o mesmo banco.
 */

export interface TargetInfo {
  kind: 'postgres' | 'pglite' | 'inválido';
  /** Host com o meio mascarado (ep-ab…yz-pooler.eu-central-1.aws.neon.tech). */
  host: string;
  pooled: boolean;
  database: string;
  /** Identidade do ambiente (endpoint sem "-pooler" + banco), para comparar; nunca impressa inteira. */
  identity: string;
}

const mask = (s: string) => (s.length <= 6 ? '••••' : `${s.slice(0, 4)}…${s.slice(-2)}`);

export function describeTarget(url: string): TargetInfo {
  if (url.startsWith('pglite:')) return { kind: 'pglite', host: 'local', pooled: false, database: url.slice(7) || 'memória', identity: url };
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('protocolo');
    const [first = '', ...rest] = u.hostname.split('.');
    const pooled = first.endsWith('-pooler');
    const endpoint = first.replace(/-pooler$/, '');
    const database = decodeURIComponent(u.pathname.replace(/^\//, '')) || '(padrão)';
    return {
      kind: 'postgres',
      host: [`${mask(endpoint)}${pooled ? '-pooler' : ''}`, ...rest].join('.'),
      pooled,
      database,
      identity: `${endpoint}.${rest.join('.')}:${u.port || '5432'}/${database}`.toLowerCase(),
    };
  } catch {
    return { kind: 'inválido', host: '?', pooled: false, database: '?', identity: `inválido:${url.length}` };
  }
}

/** Mesmo ambiente (mesmo endpoint/branch e mesmo banco), com ou sem pooler. */
export function sameTarget(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim() === b.trim() || describeTarget(a).identity === describeTarget(b).identity;
}

/** Mesmo endpoint/branch do Neon, mesmo que o banco tenha outro nome (ainda é o mesmo servidor). */
export function sameEndpoint(a: string, b: string): boolean {
  const x = describeTarget(a);
  const y = describeTarget(b);
  if (x.kind !== 'postgres' || y.kind !== 'postgres') return false;
  return x.identity.split(':')[0] === y.identity.split(':')[0];
}

/**
 * O banco de TESTES pode ser usado? Tem de existir, ser Postgres e estar num branch/endpoint diferente de TODAS as
 * URLs do banco principal. Devolve o motivo da recusa (ou null se está liberado).
 */
export function testTargetRefusal(testUrl: string, principal: string[]): string | null {
  if (!testUrl) return 'TEST_DATABASE_URL não está configurada';
  const t = describeTarget(testUrl);
  if (t.kind !== 'postgres') return 'TEST_DATABASE_URL não é um endereço postgres://';
  for (const p of principal.filter(Boolean)) {
    if (sameTarget(testUrl, p)) return 'TEST_DATABASE_URL aponta para o MESMO banco do principal';
    if (sameEndpoint(testUrl, p)) return 'TEST_DATABASE_URL está no MESMO endpoint/branch do principal (precisa ser um branch separado do Neon)';
  }
  return null;
}
