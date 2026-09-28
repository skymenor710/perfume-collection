import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../apps/server/src/http/v1';
import type { LibraryRepository } from '../apps/server/src/repositories/library';
import { fakeExecutor } from './helpers/import-fakes';

/**
 * API v1 e rotas antigas, de ponta a ponta por HTTP, com a implementação REAL da biblioteca (store.ts) numa pasta
 * de dados temporária semeada pela planilha — nada de banco falso. Só o motor de pesquisa é substituído
 * (sem internet nos testes).
 */

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-api-'));
let base = '';
let server: http.Server;
let repo: LibraryRepository;
let deny = false;
let seedCount = 0;

beforeAll(async () => {
  process.env.PERFUMES_DATA_DIR = dataDir;
  process.env.PERFUMES_HOST = '127.0.0.1';
  process.env.PERFUMES_ACCESS_CODE = 'TESTE1';
  process.env.LOG_LEVEL = 'silent';
  const { reloadConfig } = await import('../apps/server/src/config');
  reloadConfig();
  const { loadStore, store } = await import('../apps/server/src/store');
  const { createHandler } = await import('../apps/server/src/http/app');
  const { ImportJobRunner } = await import('../apps/server/src/jobs/runner');
  const { MemoryImportJobStore } = await import('../apps/server/src/jobs/memory-store');
  const { Slots } = await import('../apps/server/src/jobs/slots');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  loadStore();
  repo = store;
  seedCount = (JSON.parse(readFileSync('apps/web/src/data/seed.json', 'utf8')) as unknown[]).length;
  const jobs = new ImportJobRunner(new MemoryImportJobStore(), fakeExecutor(), new Slots(2));
  const ownerId = (await store.me()).id;
  const authorize = (): Principal | null => (deny ? null : { userId: ownerId, via: 'loopback' });
  const handle = createHandler({ repo: store, jobs, authorize });
  server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  // O Host é conferido contra a porta configurada: a porta sorteada vira a porta do app.
  process.env.PERFUMES_PORT = String(port);
  reloadConfig();
  base = `http://localhost:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const api = (p: string, init: RequestInit = {}) => fetch(`${base}${p}`, init);
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });

async function waitJob(id: string, done = (s: string) => s !== 'queued' && s !== 'running') {
  for (let i = 0; i < 200; i++) {
    const { job } = await (await api(`/api/v1/imports/${id}`)).json();
    if (done(job.status)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job não terminou');
}

describe('API v1 — acesso', () => {
  it('health é público e não fala da coleção', async () => {
    deny = true;
    const res = await api('/api/v1/health');
    deny = false;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, api: 'v1' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['/api/v1/me', '/api/v1/perfumes', '/api/v1/wishlist', '/api/v1/collection', '/api/v1/imports', '/api/v1/sources'])('%s sem autorização → 401', async (p) => {
    deny = true;
    const res = await api(p);
    deny = false;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'pairing_required', message: expect.any(String) } });
  });

  it('criar importação sem autorização → 401 (e nada é criado)', async () => {
    deny = true;
    const res = await post('/api/v1/imports', { url: 'https://ok.test/p' });
    deny = false;
    expect(res.status).toBe(401);
    expect((await (await api('/api/v1/imports')).json()).jobs).toEqual([]);
  });

  it('Host estranho → 421 (DNS rebinding), antes de qualquer rota', async () => {
    const res = await new Promise<number>((resolve) => {
      const u = new URL(base);
      http.get({ host: '127.0.0.1', port: u.port, path: '/api/v1/health', headers: { Host: 'evil.com' } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
    });
    expect(res).toBe(421);
  });

  it('escrita de outra origem → 403 (CSRF)', async () => {
    const res = await post('/api/v1/imports', { url: 'https://ok.test/p' }, { Origin: 'https://evil.com' });
    expect(res.status).toBe(403);
  });

  it('corpo inválido: tipo 415, JSON quebrado 400, campos 422, grande demais 413', async () => {
    expect((await api('/api/v1/imports', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: base }, body: 'x' })).status).toBe(415);
    expect((await api('/api/v1/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{' })).status).toBe(400);
    expect((await post('/api/v1/imports', { url: '' })).status).toBe(422);
    expect((await post('/api/v1/imports', { url: `https://ok.test/${'a'.repeat(70 * 1024)}` })).status).toBe(413);
  });

  it('rota desconhecida → 404 JSON', async () => {
    const res = await api('/api/v1/nada');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('API v1 — coleção', () => {
  it('perfumes = mesma coleção das rotas antigas', async () => {
    const v1 = await (await api('/api/v1/perfumes')).json();
    const legacy = await (await api('/api/perfumes')).json();
    expect(v1.perfumes).toEqual(legacy.perfumes);
    expect(v1.perfumes.length).toBe(seedCount);
    expect(v1.revision).toBe(legacy.revision);
  });

  it('wishlist + coleção = tudo, sem sobreposição', async () => {
    const all = (await (await api('/api/v1/perfumes')).json()).perfumes as { id: string; status: string }[];
    const wish = (await (await api('/api/v1/wishlist')).json()).perfumes as { id: string }[];
    const owned = (await (await api('/api/v1/collection')).json()).perfumes as { id: string }[];
    expect(wish.length + owned.length).toBe(all.length);
    expect(owned.every((p) => all.find((a) => a.id === p.id)?.status === 'owned')).toBe(true);
  });

  it('um perfume pelo id; id inexistente ou malformado → 404', async () => {
    const [first] = await repo.list();
    expect((await (await api(`/api/v1/perfumes/${first!.id}`)).json()).perfume.id).toBe(first!.id);
    expect((await api('/api/v1/perfumes/nao-existe')).status).toBe(404);
    expect((await api('/api/v1/perfumes/..%2F..%2Fpackage.json')).status).toBe(404);
  });

  it('perfil: leitura e atualização validada', async () => {
    const me = (await (await api('/api/v1/me')).json()).user;
    expect(me.username).toBeTruthy();
    const bad = await api('/api/v1/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'admin' }) });
    expect(bad.status).toBe(422);
  });

  it('fontes: retrato sem chaves', async () => {
    const { sources } = await (await api('/api/v1/sources')).json();
    expect(sources.map((s: { kind: string }) => s.kind)).toEqual(expect.arrayContaining(['catalog', 'productPage', 'officialStore', 'perfumeDatabase', 'searchAPI', 'reseller']));
  });
});

describe('API v1 — importação por job', () => {
  it('POST cria (202 + Location), GET acompanha, termina com o resultado', async () => {
    const res = await post('/api/v1/imports', { url: 'https://ok.test/perfume' });
    expect(res.status).toBe(202);
    const { job, deduplicated } = await res.json();
    expect(deduplicated).toBe(false);
    expect(res.headers.get('location')).toBe(`/api/v1/imports/${job.id}`);
    expect(job).not.toHaveProperty('ownerId');
    const done = await waitJob(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.result.perfume.name).toBe('Reflection');
    // Um job só pesquisa: a coleção não muda sozinha.
    expect((await repo.list()).length).toBe(seedCount);
  });

  it('fluxo de eventos (SSE) entrega o estado até terminar', async () => {
    const { job } = await (await post('/api/v1/imports', { url: 'https://ok.test/sse' })).json();
    const res = await api(`/api/v1/imports/${job.id}/events`);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text(); // o servidor fecha quando o job termina
    const events = text
      .split('\n\n')
      .filter((b) => b.startsWith('event: job'))
      .map((b) => JSON.parse(b.split('data: ')[1]!));
    expect(events.at(-1).status).toBe('succeeded');
  });

  it('versões: espera a escolha; retry com a versão conclui', async () => {
    const { job } = await (await post('/api/v1/imports', { url: 'https://choose.test/p' })).json();
    const waiting = await waitJob(job.id);
    expect(waiting.status).toBe('waiting_choice');
    expect(waiting.result.variants).toHaveLength(1);
    const retry = await post(`/api/v1/imports/${job.id}/retry`, { variantId: '50' });
    expect(retry.status).toBe(202);
    const done = await waitJob(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.input.variantId).toBe('50');
  });

  it('cancelar (DELETE) um job em andamento', async () => {
    const { job } = await (await post('/api/v1/imports', { url: 'https://slow.test/p' })).json();
    await waitJob(job.id, (s) => s === 'running');
    const res = await api(`/api/v1/imports/${job.id}`, { method: 'DELETE', headers: { Origin: base } });
    expect((await res.json()).job.status).toBe('cancelled');
    expect((await waitJob(job.id)).status).toBe('cancelled');
  });

  it('retry de job concluído → 409; job inexistente → 404', async () => {
    const { job } = await (await post('/api/v1/imports', { url: 'https://ok.test/409' })).json();
    await waitJob(job.id);
    expect((await post(`/api/v1/imports/${job.id}/retry`, {})).status).toBe(409);
    expect((await api('/api/v1/imports/imp_nao-existe')).status).toBe(404);
  });

  it('falha técnica chega como frase, nunca como detalhe interno', async () => {
    const { job } = await (await post('/api/v1/imports', { url: 'https://boom.test/p' })).json();
    const failed = await waitJob(job.id);
    expect(failed.error).toEqual({ code: 'internal', message: 'Algo deu errado aqui. Tente de novo.' });
    expect(JSON.stringify(failed)).not.toMatch(/ECONNRESET|10\.0\.0\.3/);
  });
});

describe('rotas antigas preservadas e protegidas', () => {
  it('status, perfumes e perfil continuam respondendo igual', async () => {
    expect((await (await api('/api/status')).json()).app).toBe('perfume-collection');
    expect((await (await api('/api/perfumes')).json()).perfumes.length).toBe(seedCount);
    expect((await (await api('/api/me')).json()).user.username).toBeTruthy();
  });

  it('coleção privada não vaza pela rota pública; lista aberta não mostra campos pessoais', async () => {
    const me = (await (await api('/api/me')).json()).user;
    expect((await api(`/api/public/${me.username}`)).status).toBe(404);
    expect((await api(`/api/public/${me.username}/wishlist`)).status).toBe(404);
    await api('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ privacy: { wishlist: 'public' } }) });
    const pub = await (await api(`/api/public/${me.username}/wishlist`)).json();
    expect(pub.perfumes.length).toBeGreaterThan(0);
    for (const p of pub.perfumes) {
      expect(p.notes ?? null).toBeNull();
      expect(p.fieldSources ?? {}).toEqual({});
    }
    expect((await api(`/api/public/${me.username}/collection`)).status).toBe(404); // a outra lista segue fechada
    await api('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ privacy: { wishlist: 'private' } }) });
    expect((await api(`/api/public/${me.username}/wishlist`)).status).toBe(404);
  });

  it('mídia: travessia de pasta vira 404', async () => {
    for (const p of ['/media/..%2f..%2fpackage.json', '/media/%2e%2e/%2e%2e/package.json', '/media/..\\..\\package.json', '/media/nao-existe.webp']) {
      expect((await api(p)).status).toBe(404);
    }
  });

  it('arquivos do site: travessia e escape malformado não quebram', async () => {
    expect((await api('/%E0%A4%A')).status).toBeLessThan(500);
    const res = await api('/..%2f..%2fpackage.json');
    expect(await res.text()).not.toContain('"workspaces"');
  });

  it('foto enviada: SVG disfarçado de PNG é recusado', async () => {
    const res = await api('/api/photo', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: base }, body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    expect(res.status).toBe(415);
  });
});
