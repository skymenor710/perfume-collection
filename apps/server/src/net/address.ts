import net from 'node:net';

/**
 * Quais endereços IP o servidor NUNCA pode buscar (proteção contra SSRF). Função pura, testada à parte.
 *
 * IPv6 é expandido para 8 grupos antes de comparar, então formas equivalentes (`::1`, `0:0:0:0:0:0:0:1`,
 * `::ffff:7f00:1`) caem na mesma regra. Faixas que embutem um IPv4 (mapeado, compatível, NAT64, 6to4, Teredo)
 * são bloqueadas inteiras: um endereço público "por fora" pode levar a um IPv4 interno "por dentro".
 */

function ipv4Private(address: string): boolean {
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return (
    a === 0 || // "esta rede"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (inclui metadados de nuvem 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0/24 (IETF) e 192.0.2/24 (documentação)
    (a === 192 && b === 88 && c === 99) || // relay 6to4 anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    (a === 198 && b === 51 && c === 100) || // documentação
    (a === 203 && b === 0 && c === 113) || // documentação
    a >= 224 // multicast, reservado e broadcast
  );
}

/** "2001:db8::1" → [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]. Aceita IPv4 no fim (::ffff:1.2.3.4). Nulo se inválido. */
export function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4?.[1]) {
    if (!net.isIPv4(v4[1])) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4[1].split('.').map(Number);
    text = `${text.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function ipv6Private(address: string): boolean {
  const g = expandIpv6(address);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, , g5 = 0] = g;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (zeros(6)) return true; // ::, ::1 e ::a.b.c.d (IPv4 compatível, obsoleto)
  // IPv4 mapeado (::ffff:a.b.c.d): o servidor fala IPv4 por IPv4. Por IPv6, recusado mesmo se o IPv4 for público —
  // é o formato clássico para driblar filtro que só olha a forma textual.
  if (zeros(5) && g5 === 0xffff) return true;
  if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64 64:ff9b::/96 e 64:ff9b:1::/48
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 descarte
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo 2001:0::/32 (embute IPv4 do servidor e do cliente)
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentação
  if (g0 === 0x2001 && g1 >= 0x10 && g1 <= 0x2f) return true; // ORCHID
  if (g0 === 0x2002) return true; // 6to4 2002::/16 (embute IPv4 nos grupos 1–2)
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 local única
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsoleto)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Endereços que nunca podem ser buscados a partir do servidor (SSRF). Texto que não é IP também é recusado. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) return ipv4Private(bare);
  if (net.isIPv6(bare)) return ipv6Private(bare);
  return true;
}

/** Só as portas web padrão. A porta vazia (padrão do protocolo) conta como 80/443. */
export function isAllowedPort(url: URL): boolean {
  return url.port === '' || url.port === '80' || url.port === '443';
}
