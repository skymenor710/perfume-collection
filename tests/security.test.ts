import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHost, checkSameOrigin, HttpError } from '../apps/server/src/http/guard';
import { decodePath, inside } from '../apps/server/src/http/paths';
import { expandIpv6, isAllowedPort, isPrivateAddress } from '../apps/server/src/net/address';
import { FetchError, nextHop, safeFetch, safeFetchImage, validateUrl } from '../apps/server/src/net/safe-fetch';
import { checkImageBytes, looksLikeMarkup, sniffImage } from '../apps/server/src/net/sniff';

/* ------------------------------------------------------------------ SSRF: endereços */

describe('isPrivateAddress — IPv4', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '127.255.255.254',
    '100.64.0.1',
    '169.254.169.254', // metadados de nuvem
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
  ])('bloqueia %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '151.101.1.69'])('libera %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('isPrivateAddress — IPv6', () => {
  it.each([
    ['::', 'não especificado'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback por extenso'],
    ['[::1]', 'loopback entre colchetes'],
    ['::ffff:127.0.0.1', 'IPv4 mapeado (interno)'],
    ['::ffff:7f00:1', 'IPv4 mapeado em hexa'],
    ['::ffff:8.8.8.8', 'IPv4 mapeado mesmo público'],
    ['::127.0.0.1', 'IPv4 compatível'],
    ['64:ff9b::a00:1', 'NAT64'],
    ['64:ff9b:1::1', 'NAT64 local'],
    ['100::1', 'descarte'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    ['2001::1', 'Teredo curto'],
    ['2001:db8::1', 'documentação'],
    ['2001:10::1', 'ORCHID'],
    ['2002:7f00:1::1', '6to4 embutindo 127.0.0.1'],
    ['2002:c0a8:101::1', '6to4 embutindo 192.168.1.1'],
    ['2002:808:808::1', '6to4 mesmo com IPv4 público'],
    ['fc00::1', 'local única'],
    ['fd12:3456::1', 'local única'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local com zona'],
    ['febf::1', 'link-local (fim da faixa)'],
    ['fec0::1', 'site-local obsoleto'],
    ['ff02::1', 'multicast'],
  ])('bloqueia %s (%s)', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['2606:4700:4700::1111', '2a00:1450:4007:80e::200e', '2001:4860:4860::8888', '2600::1'])('libera %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('texto que não é IP é recusado', () => {
    expect(isPrivateAddress('localhost')).toBe(true);
    expect(isPrivateAddress('exemplo.com')).toBe(true);
  });

  it('expande formas equivalentes para os mesmos 8 grupos', () => {
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6('::ffff:10.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001]);
    expect(expandIpv6('1::2::3')).toBeNull();
    expect(expandIpv6('12345::1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ SSRF: URL, portas, redirecionamentos */

describe('validateUrl — protocolo, credenciais, portas', () => {
  it('aceita http/https nas portas padrão', () => {
    expect(validateUrl('https://loja.com/p').hostname).toBe('loja.com');
    expect(validateUrl('https://loja.com:443/p').port).toBe('');
    expect(validateUrl('http://loja.com:80/p').port).toBe('');
    expect(validateUrl('http://loja.com:443/p').port).toBe('443');
  });

  it.each(['https://loja.com:8080/', 'http://loja.com:22/', 'https://loja.com:6379/', 'http://loja.com:3100/', 'https://loja.com:1/'])('recusa porta fora de 80/443: %s', (u) => {
    expect(() => validateUrl(u)).toThrowError(expect.objectContaining({ code: 'invalid_url' }));
  });

  it.each(['file:///etc/passwd', 'ftp://loja.com/', 'gopher://loja.com/', 'javascript:alert(1)', 'data:text/html,oi'])('recusa protocolo %s', (u) => {
    expect(() => validateUrl(u)).toThrowError(FetchError);
  });

  it('recusa usuário/senha na URL', () => {
    expect(() => validateUrl('https://a:b@loja.com/')).toThrowError(expect.objectContaining({ code: 'invalid_url' }));
  });

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/', // 127.0.0.1 em decimal
    'http://0x7f.1/', // 127.0.0.1 em hexa curto
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[2002:7f00:1::1]/',
    'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
  ])('recusa IP interno escrito no link: %s', (u) => {
    expect(() => validateUrl(u)).toThrowError(expect.objectContaining({ code: 'private_address' }));
  });

  it('isAllowedPort', () => {
    expect(isAllowedPort(new URL('https://a.com'))).toBe(true);
    expect(isAllowedPort(new URL('https://a.com:8443'))).toBe(false);
  });
});

describe('redirecionamentos passam pelas mesmas regras', () => {
  const from = new URL('https://loja.com/produto');

  it('segue destino público relativo e absoluto', () => {
    expect(nextHop('/outra', from).toString()).toBe('https://loja.com/outra');
    expect(nextHop('https://cdn.loja.com/x.jpg', from).hostname).toBe('cdn.loja.com');
  });

  it.each([
    ['http://127.0.0.1/admin', 'private_address'],
    ['http://[::1]:80/', 'private_address'],
    ['http://169.254.169.254/', 'private_address'],
    ['http://[2002:a00:1::]/', 'private_address'],
    ['https://loja.com:8443/', 'invalid_url'],
    ['file:///etc/passwd', 'invalid_url'],
    ['https://user:pw@loja.com/', 'invalid_url'],
  ])('recusa redirecionar para %s', (location, code) => {
    expect(() => nextHop(location, from)).toThrowError(expect.objectContaining({ code }));
  });

  it('nome que resolve para endereço interno é barrado na conexão (DNS vigiado)', async () => {
    await expect(safeFetch('http://localhost/', { timeoutMs: 3000 })).rejects.toMatchObject({ code: 'private_address' });
  });

  it('imagem em porta não padrão nem chega a ser pedida', async () => {
    await expect(safeFetchImage('https://exemplo.com:8443/foto.png')).rejects.toMatchObject({ code: 'invalid_url' });
  });
});

/* ------------------------------------------------------------------ imagens: tipo real e SVG */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(10)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.from([0, 0, 0, 0]), Buffer.from('avifmif1miaf'), Buffer.alloc(8)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('tipo de imagem pelos bytes', () => {
  it('reconhece os formatos aceitos', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(JPEG)).toBe('jpeg');
    expect(sniffImage(GIF)).toBe('gif');
    expect(sniffImage(WEBP)).toBe('webp');
    expect(sniffImage(AVIF)).toBe('avif');
    expect(sniffImage(Buffer.from('hello world, not an image'))).toBeNull();
  });

  it('SVG é recusado mesmo declarado como PNG', () => {
    expect(checkImageBytes(SVG, 'image/png')).toEqual({ ok: false, reason: 'svg' });
  });

  it('SVG com declaração XML, BOM e espaços também', () => {
    const tricky = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\n  <?xml version="1.0"?>\n<svg></svg>')]);
    expect(looksLikeMarkup(tricky)).toBe(true);
    expect(checkImageBytes(tricky, 'image/webp').ok).toBe(false);
  });

  it('Content-Type image/svg+xml é recusado mesmo com bytes de PNG', () => {
    expect(checkImageBytes(PNG, 'image/svg+xml')).toEqual({ ok: false, reason: 'svg' });
  });

  it('HTML fingindo ser imagem é recusado', () => {
    expect(checkImageBytes(Buffer.from('<!doctype html><html><body>oi</body></html>'), 'image/jpeg').ok).toBe(false);
  });

  it('o tipo aceito é o dos bytes, não o declarado', () => {
    expect(checkImageBytes(JPEG, 'image/png')).toEqual({ ok: true, kind: 'jpeg', mime: 'image/jpeg' });
  });
});

/* ------------------------------------------------------------------ travessia de pastas */

describe('inside() — nunca sai da pasta', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'perfumes-inside-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'assets', 'app.js'), 'ok');
  writeFileSync(path.join(path.dirname(root), 'segredo-perfumes.txt'), 'não');

  it('acha arquivo de dentro', () => {
    expect(inside(root, 'assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(inside(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
  });

  it.each(['../segredo-perfumes.txt', '/../segredo-perfumes.txt', 'assets/../../segredo-perfumes.txt', '..\\segredo-perfumes.txt', 'assets\\..\\..\\segredo-perfumes.txt', 'assets/app.js\0.png', 'assets'])(
    'recusa %j',
    (rel) => expect(inside(root, rel)).toBeNull(),
  );

  it('caminho absoluto vira relativo à pasta (não abre o disco)', () => {
    expect(inside(root, path.join(path.dirname(root), 'segredo-perfumes.txt'))).toBeNull();
  });

  it('decodePath não explode com escape malformado', () => {
    expect(decodePath('/%E0%A4%A')).toBeNull();
    expect(decodePath('/a%20b')).toBe('/a b');
  });
});

/* ------------------------------------------------------------------ Host e mesma origem (CSRF) */

const fakeReq = (headers: Record<string, string>, method = 'GET') => ({ headers, method, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;

describe('checkHost — contra DNS rebinding', () => {
  const port = Number(process.env.PERFUMES_PORT) || 3100;

  it('aceita localhost na porta do app', () => {
    expect(() => checkHost(fakeReq({ host: `localhost:${port}` }))).not.toThrow();
    expect(() => checkHost(fakeReq({ host: `127.0.0.1:${port}` }))).not.toThrow();
  });

  it.each(['evil.com', `evil.com:${port}`, 'localhost:1', `localhost.evil.com:${port}`, ''])('recusa Host %j', (host) => {
    expect(() => checkHost(fakeReq({ host }))).toThrowError(expect.objectContaining({ status: 421 }));
  });
});

describe('checkSameOrigin — contra CSRF', () => {
  const host = 'localhost:3100';

  it('leitura (GET) passa', () => expect(() => checkSameOrigin(fakeReq({ host, origin: 'https://evil.com' }, 'GET'))).not.toThrow());

  it('escrita da mesma origem passa', () => {
    expect(() => checkSameOrigin(fakeReq({ host, origin: `http://${host}` }, 'POST'))).not.toThrow();
    expect(() => checkSameOrigin(fakeReq({ host, 'sec-fetch-site': 'same-origin' }, 'DELETE'))).not.toThrow();
  });

  it.each([
    [{ origin: 'https://evil.com' }, 'POST'],
    [{ origin: 'http://localhost:9999' }, 'PUT'],
    [{ origin: 'null' }, 'PATCH'],
    [{ 'sec-fetch-site': 'cross-site' }, 'POST'],
    [{ 'sec-fetch-site': 'same-site' }, 'DELETE'],
  ])('recusa %j em %s', (extra, method) => {
    expect(() => checkSameOrigin(fakeReq({ host, ...extra }, method))).toThrowError(HttpError);
  });
});
