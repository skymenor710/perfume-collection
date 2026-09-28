import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../apps/server/src/db/client';
import type { LibraryRepository } from '../apps/server/src/repositories/library';
import { fixtureLibrary, freshDb } from './helpers/db';

/**
 * A MESMA API servida por dois backends — data/library.json e Postgres — com os mesmos dados, comparada resposta a
 * resposta, byte a byte. Usa a coleção real (cópia de data/library.json) quando ela existe neste computador; no CI,
 * a biblioteca de teste. Nada é gravado nos dados reais: tudo roda numa pasta temporária.
 */

const realFile = path.join('data', 'library.json');
const usingReal = existsSync(realFile);
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-equiv-'));
let handle: DbHandle;
let servers: http.Server[] = [];
let jsonBase = '';
let pgBase = '';

async function serve(repo: LibraryRepository): Promise<{ server: http.Server; port: number }> {
  const { createHandler } = await import('../apps/server/src/http/app');
  const { ImportJobRunner } = await import('../apps/server/src/jobs/runner');
  const { MemoryImportJobStore } = await import('../apps/server/src/jobs/memory-store');
  const ownerId = (await repo.me()).id;
  const handler = createHandler({ repo, jobs: new ImportJobRunner(new MemoryImportJobStore()), authorize: () => ({ userId: ownerId, via: 'loopback' }) });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

beforeAll(async () => {
  process.env.PERFUMES_DATA_DIR = dataDir;
  process.env.PERFUMES_HOST = '127.0.0.1';
  process.env.PERFUMES_ACCESS_CODE = 'TESTE1';
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  if (usingReal) copyFileSync(realFile, path.join(dataDir, 'library.json'));
  else writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify(fixtureLibrary(), null, 2));

  const { reloadConfig } = await import('../apps/server/src/config');
  reloadConfig();
  const { loadStore, store } = await import('../apps/server/src/store');
  loadStore();

  // O Postgres recebe exatamente o que o JSON tem depois de carregado.
  handle = await freshDb();
  const { validateLibrary, importLibrary } = await import('../apps/server/src/db/importer');
  const library = JSON.parse(readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
  // Os arquivos de imagem não entram nesta comparação (são conferidos em db.test e no db:verify): qualquer arquivo existente serve.
  const report = await importLibrary(handle.db, validateLibrary(library, () => path.resolve('package.json')));
  if (!report.ok) throw new Error(report.message);
  const { PostgresLibraryRepository } = await import('../apps/server/src/repositories/postgres');
  const pgRepo = await PostgresLibraryRepository.open(handle.db);

  const a = await serve(store);
  const b = await serve(pgRepo);
  servers = [a.server, b.server];
  // O Host é conferido contra a porta configurada: cada servidor responde pela própria porta; o JSON vira a "oficial".
  jsonBase = `http://127.0.0.1:${a.port}`;
  pgBase = `http://127.0.0.1:${b.port}`;
});

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  await handle?.close();
});

/** Pede a mesma coisa aos dois servidores (mesma origem de cada um, como o navegador faria). */
async function both(pathname: string, init: RequestInit = {}) {
  const { reloadConfig } = await import('../apps/server/src/config');
  const ask = async (base: string) => {
    process.env.PERFUMES_PORT = new URL(base).port;
    reloadConfig();
    const res = await fetch(`${base}${pathname}`, { ...init, headers: { ...(init.headers ?? {}), Origin: base } });
    return { status: res.status, body: await res.text() };
  };
  return { json: await ask(jsonBase), pg: await ask(pgBase) };
}

describe(`API igual nos dois backends (${usingReal ? 'coleção REAL, cópia' : 'biblioteca de teste'})`, () => {
  it('GET /api/perfumes: mesma lista, byte a byte (fora o contador de sincronização)', async () => {
    const { json, pg } = await both('/api/perfumes');
    expect([json.status, pg.status]).toEqual([200, 200]);
    const a = JSON.parse(json.body);
    const b = JSON.parse(pg.body);
    expect(JSON.stringify(b.perfumes)).toBe(JSON.stringify(a.perfumes));
    expect(typeof a.revision).toBe('number');
    expect(typeof b.revision).toBe('number');
    if (usingReal) {
      expect(b.perfumes).toHaveLength(15);
      const r = b.perfumes.find((p: { name: string }) => /reflection/i.test(p.name));
      expect([r.volume, r.selectedVariantId, r.price, r.currency, r.status]).toEqual(['50 ml', '58518844047705', 35.95, 'EUR', 'wishlist']);
    }
  });

  it('GET /api/v1/perfumes, /wishlist, /collection, /me', async () => {
    for (const p of ['/api/v1/perfumes', '/api/v1/wishlist', '/api/v1/collection']) {
      const { json, pg } = await both(p);
      expect(JSON.stringify(JSON.parse(pg.body).perfumes)).toBe(JSON.stringify(JSON.parse(json.body).perfumes));
    }
    const me = await both('/api/me');
    expect(me.pg.body).toBe(me.json.body);
  });

  it('páginas públicas: fechada = 404 nos dois; aberta = mesma resposta; mídia pública igual', async () => {
    const username = JSON.parse((await both('/api/me')).json.body).user.username;
    const closed = await both(`/api/public/${username}/wishlist`);
    expect([closed.json.status, closed.pg.status]).toEqual([404, 404]);
    const patch = await both('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacy: { wishlist: 'public' } }) });
    // O perfil salvo é o mesmo nos dois (updatedAt é o relógio de cada gravação).
    const user = (b: string) => ({ ...JSON.parse(b).user, updatedAt: '' });
    expect(user(patch.pg.body)).toEqual(user(patch.json.body));
    const open = await both(`/api/public/${username}/wishlist`);
    expect([open.json.status, open.pg.status]).toEqual([200, 200]);
    expect(open.pg.body).toBe(open.json.body);
    // HTML com metadados (Open Graph): o único pedaço diferente é a porta de cada servidor de teste no link canônico.
    const page = await both(`/${username}/wishlist`);
    const port = (html: string) => html.replace(/127\.0\.0\.1:\d+|localhost:\d+/g, 'HOST');
    expect(port(page.pg.body)).toBe(port(page.json.body));
    expect(page.pg.body).toMatch(/og:title/);
  });

  it('gravar a mesma alteração nos dois dá o mesmo resultado', async () => {
    const list = JSON.parse((await both('/api/perfumes')).json.body).perfumes;
    const target = { ...list[0], personalRating: 'very_good', price: 42.5, currency: 'EUR' };
    const put = await both(`/api/perfumes/${encodeURIComponent(target.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
    const strip = (s: string) => JSON.parse(s).perfume;
    const a = strip(put.json.body);
    const b = strip(put.pg.body);
    // updatedAt é o relógio de cada gravação; o resto tem de bater.
    expect({ ...b, updatedAt: '' }).toEqual({ ...a, updatedAt: '' });
    const after = await both('/api/perfumes');
    const norm = (s: string) => JSON.parse(s).perfumes.map((p: { updatedAt: string }) => ({ ...p, updatedAt: '' }));
    expect(norm(after.pg.body)).toEqual(norm(after.json.body));
  });
});
