import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyPerfumeView, sanitizeLibrary, type Library } from '@perfumes/core/library';
import { safeImageRef, sanitizePerfume, type Perfume } from '@perfumes/core/perfume';
import { reloadConfig, config } from '../apps/server/src/config';
import { readBaseline, resolveImageFile } from '../apps/server/src/db/checks';
import { importLibrary, validateLibrary } from '../apps/server/src/db/importer';
import { loadLibrary } from '../apps/server/src/db/snapshot';
import { contentSecurityPolicy, localFileForKey, referencedWithOriginals, routeContentKey, seedRefs, absoluteImageUrl, type MediaSettings } from '../apps/server/src/media/content';
import { collectMediaGarbage } from '../apps/server/src/media/gc';
import { MediaMap, MediaMapError, type RefChange } from '../apps/server/src/media/map';
import { applyRefChanges, dryRun, inventory, migrateObjects, planCutover, planRollback, refLocations } from '../apps/server/src/media/migrate';
import { saveBottleMedia } from '../apps/server/src/media/store';
import type { ProcessedBottle } from '../apps/server/src/media/process';
import { log } from '../apps/server/src/log';
import { seedUpgrades } from '../apps/server/src/repositories/rules';
import { contentAddress, isContentKey, matchesContentKey, shaOfContentKey } from '../apps/server/src/storage/keys';
import { LocalStorageProvider } from '../apps/server/src/storage/local';
import { R2StorageProvider } from '../apps/server/src/storage/r2';
import { ChecksumMismatchError, StorageUnavailableError } from '../apps/server/src/storage/types';
import { FakeR2StorageProvider } from './helpers/fake-r2';
import { startFakeS3, type FakeS3 } from './helpers/fake-s3-server';
import { fixtureLibrary, freshDb, OWNER } from './helpers/db';

/**
 * FASE 3.0 — R2 implementado e provado LOCALMENTE. Nada aqui fala com a Cloudflare: o R2 é um falso em memória
 * (FakeR2StorageProvider) ou um servidor S3 falso em 127.0.0.1 (para o R2StorageProvider de verdade). Tudo numa pasta
 * de dados temporária; as fotos reais do projeto só são LIDAS (teste das 32 imagens).
 */

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perfumes-r2-'));
const work = mkdtempSync(path.join(os.tmpdir(), 'perfumes-r2-work-'));
process.env.PERFUMES_DATA_DIR = dataDir;
process.env.PERFUMES_HOST = '127.0.0.1';
process.env.PERFUMES_ACCESS_CODE = 'TESTE1';
process.env.LOG_LEVEL = 'silent';
delete process.env.MEDIA_BACKEND;
delete process.env.MEDIA_FALLBACK;
reloadConfig();
mkdirSync(path.join(dataDir, 'media'), { recursive: true });

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let color = 0;
/** Imagem de verdade (sharp), com uma cor diferente a cada chamada: conteúdo único. */
async function image(format: 'webp' | 'png' = 'webp', rgb?: [number, number, number]): Promise<Buffer> {
  color++;
  const [r, g, b] = rgb ?? [(color * 37) % 256, (color * 91) % 256, (color * 53) % 256];
  const img = sharp({ create: { width: 6, height: 6, channels: 4, background: { r, g, b, alpha: 1 } } });
  return format === 'png' ? img.png().toBuffer() : img.webp({ lossless: true }).toBuffer();
}
/** Grava em <dataDir>/media/<name> e devolve a referência "media/<name>". */
function writeMedia(name: string, body: Buffer): string {
  writeFileSync(path.join(dataDir, 'media', name), body);
  return `media/${name}`;
}
let mapCount = 0;
const newMap = () => new MediaMap(path.join(work, `map-${++mapCount}.json`));
/** Resolvedor de teste: "bottles/…" e "media/…" dentro de uma pasta qualquer. */
const folderResolver = (root: string) => (ref: string) => path.join(root, ...ref.split('/'));
const settingsFor = (backend: 'local' | 'r2', remote: FakeR2StorageProvider | null, map: MediaMap, fallback: 'none' | 'local' = 'none'): MediaSettings => ({ backend, fallback, remote, map });

function tinyLibrary(images: { product: string; url: string; thumbUrl?: string | null; masterUrl?: string | null }[], avatar: string | null = null): Library {
  return {
    schemaVersion: 2,
    users: [{ ...OWNER, avatarUrl: avatar }],
    products: images.map((i) => ({ id: i.product, images: [{ role: 'main', url: i.url, thumbUrl: i.thumbUrl ?? null, masterUrl: i.masterUrl ?? null, variantId: null, transparent: true, source: null, credit: null }] })),
    entries: [],
  } as unknown as Library;
}

/* ================================================================== chaves e deduplicação */

describe('chave por conteúdo p/<sha256>.<formato>', () => {
  it('determinística e derivada só do conteúdo (estável entre chamadas e reinícios)', async () => {
    const body = await image();
    const a = contentAddress(body);
    expect(a.key).toBe(`p/${sha(body)}.webp`);
    expect(contentAddress(Buffer.from(body)).key).toBe(a.key);
    expect(shaOfContentKey(a.key)).toBe(sha(body));
    expect(matchesContentKey(a.key, body)).toBe(true);
  });

  it('CASO A: bottles/a.webp e media/b.webp com o MESMO conteúdo → mesmo SHA-256, mesma chave, UM objeto', async () => {
    const root = mkdtempSync(path.join(work, 'caso-a-'));
    const body = await image();
    mkdirSync(path.join(root, 'bottles'));
    mkdirSync(path.join(root, 'media'));
    writeFileSync(path.join(root, 'bottles', 'a.webp'), body);
    writeFileSync(path.join(root, 'media', 'b.webp'), body);
    const items = inventory(['bottles/a.webp', 'media/b.webp'], folderResolver(root));
    expect(items[0]!.sha256).toBe(items[1]!.sha256);
    expect(items[0]!.key).toBe(items[1]!.key);
    const remote = new FakeR2StorageProvider();
    const map = newMap();
    const report = await migrateObjects(items, { remote, map });
    expect(report.ok).toBe(true);
    expect(remote.calls.put).toBe(1);
    expect(remote.objects.size).toBe(1);
    expect(map.originalsFor(items[0]!.key!)).toEqual(['bottles/a.webp', 'media/b.webp']);
  });

  it('CASO B: mesmo nome, conteúdo diferente → SHA-256 e chaves diferentes', async () => {
    const r1 = mkdtempSync(path.join(work, 'caso-b1-'));
    const r2 = mkdtempSync(path.join(work, 'caso-b2-'));
    for (const r of [r1, r2]) mkdirSync(path.join(r, 'media'));
    writeFileSync(path.join(r1, 'media', 'x.webp'), await image());
    writeFileSync(path.join(r2, 'media', 'x.webp'), await image());
    const [a] = inventory(['media/x.webp'], folderResolver(r1));
    const [b] = inventory(['media/x.webp'], folderResolver(r2));
    expect(a!.sha256).not.toBe(b!.sha256);
    expect(a!.key).not.toBe(b!.key);
  });

  it('CASO C: mesmo conteúdo com nomes/extensões/pastas diferentes → a MESMA chave; a extensão vem dos bytes', async () => {
    const root = mkdtempSync(path.join(work, 'caso-c-'));
    const webpBytes = await image('webp');
    const pngBytes = await image('png');
    mkdirSync(path.join(root, 'media'));
    mkdirSync(path.join(root, 'bottles'));
    // Os mesmos bytes WebP com nome .webp, .png e .jpg: a extensão do NOME não conta.
    writeFileSync(path.join(root, 'media', 'um.webp'), webpBytes);
    writeFileSync(path.join(root, 'media', 'dois.png'), webpBytes);
    writeFileSync(path.join(root, 'bottles', 'tres.jpg'), webpBytes);
    writeFileSync(path.join(root, 'media', 'png-de-verdade.png'), pngBytes);
    const items = inventory(['media/um.webp', 'media/dois.png', 'bottles/tres.jpg', 'media/png-de-verdade.png'], folderResolver(root));
    const byRef = new Map(items.map((i) => [i.ref, i.key]));
    expect(new Set([byRef.get('media/um.webp'), byRef.get('media/dois.png'), byRef.get('bottles/tres.jpg')]).size).toBe(1);
    expect(byRef.get('media/um.webp')).toMatch(/\.webp$/);
    expect(byRef.get('media/png-de-verdade.png')).toBe(`p/${sha(pngBytes)}.png`);
  });

  it('não há como formar caminho perigoso ou chave estranha; o que não é imagem é recusado', async () => {
    const good = contentAddress(await image()).key;
    for (const bad of ['p/../x.webp', `p/${'A'.repeat(64)}.webp`, `p/${'a'.repeat(63)}.webp`, `p/${'a'.repeat(64)}.svg`, `/p/${'a'.repeat(64)}.webp`, `p/${'a'.repeat(64)}.webp/..`, `media/${'a'.repeat(64)}.webp`]) {
      expect(isContentKey(bad)).toBe(false);
    }
    expect(isContentKey(good)).toBe(true);
    expect(() => contentAddress(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toThrow(/não é uma imagem/);
    expect(() => contentAddress(Buffer.from('texto qualquer, nada de imagem'))).toThrow();
  });

  it('o core aceita a referência por conteúdo e continua marcando a foto como recorte transparente', async () => {
    const key = contentAddress(await image()).key;
    expect(safeImageRef(key)).toBe(key);
    expect(safeImageRef(`${key}?x=1`)).toBeNull();
    expect(safeImageRef('p/../../etc/passwd')).toBeNull();
    const view = sanitizePerfume({ id: 'x-1', name: 'Teste', imageUrl: key, thumbUrl: key, status: 'wishlist', origin: 'url-import' })!;
    expect(view.imageUrl).toBe(key);
    expect(applyPerfumeView(null, view, OWNER.id).product.images[0]!.transparent).toBe(true);
  });
});

/* ================================================================== FakeR2 e R2StorageProvider */

describe('FakeR2StorageProvider (o R2 dos testes)', () => {
  it('cumpre o contrato: put/get/exists/delete/list/publicUrl, confere o SHA-256 e distingue ausente de indisponível', async () => {
    const r2 = new FakeR2StorageProvider();
    const body = await image();
    const { key } = contentAddress(body);
    await r2.put(key, body, { contentType: 'image/webp', sha256: sha(body) });
    expect(sha((await r2.get(key))!.body)).toBe(sha(body));
    expect(await r2.exists(key)).toBe(true);
    expect((await r2.list()).map((e) => e.key)).toEqual([key]);
    expect(r2.publicUrl(key)).toBe(`https://img.exemplo.test/${key}`);
    await expect(r2.put(key, body, { contentType: 'image/webp', sha256: 'f'.repeat(64) })).rejects.toBeInstanceOf(ChecksumMismatchError);
    r2.fail('get', 'unavailable');
    await expect(r2.get(key)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(await r2.delete(key)).toBe(true);
    expect(await r2.get(key)).toBeNull();
    expect(await r2.exists(key)).toBe(false);
  });
});

describe('R2StorageProvider contra um servidor S3 falso local (HTTP, assinatura, checksum, erros)', () => {
  let s3: FakeS3;
  let r2: R2StorageProvider;
  const SECRET = 'segredo-de-teste-nao-real';
  const ACCESS = 'chave-de-teste';
  const errors: unknown[] = [];
  const settings = () => ({ endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: ACCESS, secretAccessKey: SECRET, publicBaseUrl: 'https://img.exemplo.test/' });
  const expectUnavailable = async (p: Promise<unknown>, detail?: RegExp) => {
    const error = await p.then(
      () => null,
      (e: unknown) => e,
    );
    errors.push(error);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    if (detail) expect((error as Error).message).toMatch(detail);
  };

  beforeAll(async () => {
    s3 = await startFakeS3();
    r2 = new R2StorageProvider(settings(), { timeoutMs: 400, pageSize: 2 });
  });
  afterAll(() => s3.close());

  it('put assinado (SigV4, região auto, s3) com o SHA-256 no corpo assinado E no checksum; get/exists/list/delete', async () => {
    const bodies = await Promise.all([1, 2, 3, 4, 5].map(() => image()));
    const keys = bodies.map((b) => contentAddress(b).key);
    for (const [i, b] of bodies.entries()) await r2.put(keys[i]!, b, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable', sha256: sha(b) });
    const put = s3.requests.find((r) => r.method === 'PUT')!;
    expect(String(put.headers.authorization)).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${ACCESS}/\\d{8}/auto/s3/aws4_request`));
    expect(put.headers['x-amz-content-sha256']).toBe(sha(bodies[0]!));
    expect(put.headers['x-amz-checksum-sha256']).toBe(Buffer.from(sha(bodies[0]!), 'hex').toString('base64'));
    expect(put.path).toBe(`/${s3.bucket}/${keys[0]}`);
    expect(sha((await r2.get(keys[2]!))!.body)).toBe(sha(bodies[2]!));
    expect(await r2.exists(keys[3]!)).toBe(true);
    // 5 objetos, páginas de 2: a listagem segue a continuação até o fim.
    expect((await r2.list()).map((e) => e.key).sort()).toEqual([...keys].sort());
    expect(s3.requests.filter((r) => r.query.get('list-type') === '2').length).toBe(3);
    expect(await r2.delete(keys[4]!)).toBe(true);
    expect(await r2.delete(keys[4]!)).toBe(false);
    expect(await r2.get(keys[4]!)).toBeNull();
    expect(await r2.exists(keys[4]!)).toBe(false);
  });

  it('publicUrl usa só a base pública configurada (sem barra dupla, sem endpoint S3)', () => {
    const key = `p/${'a'.repeat(64)}.webp`;
    expect(r2.publicUrl(key)).toBe(`https://img.exemplo.test/${key}`);
    expect(r2.publicUrl(key)).not.toContain(s3.endpoint);
  });

  it('checksum: conteúdo ≠ SHA-256 pedido é recusado ANTES de enviar; BadDigest do servidor vira ChecksumMismatchError', async () => {
    const body = await image();
    const key = contentAddress(body).key;
    const before = s3.requests.length;
    await expect(r2.put(key, body, { contentType: 'image/webp', sha256: 'e'.repeat(64) })).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(s3.requests.length).toBe(before);
    s3.next.push({ status: 400, body: '<Error><Code>BadDigest</Code></Error>' });
    await expect(r2.put(key, body, { contentType: 'image/webp' })).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(s3.objects.has(key)).toBe(false);
  });

  it('falhas viram StorageUnavailableError — nunca "não existe": 500, 503, 403, timeout, corpo cortado, redirecionamento, resposta estranha', async () => {
    const body = await image();
    const key = contentAddress(body).key;
    await r2.put(key, body, { contentType: 'image/webp' });
    s3.next.push({ status: 500 });
    await expectUnavailable(r2.get(key), /HTTP 500/);
    s3.next.push({ status: 503 });
    await expectUnavailable(r2.exists(key), /HTTP 503/);
    s3.next.push({ status: 403 });
    await expectUnavailable(r2.put(key, body, { contentType: 'image/webp' }), /HTTP 403/);
    s3.next.push({ delayMs: 1500 });
    await expectUnavailable(r2.get(key), /sem resposta/);
    s3.next.push({ truncate: true });
    await expectUnavailable(r2.get(key));
    s3.next.push({ redirect: 'https://outro.exemplo.test/x', status: 302 });
    await expectUnavailable(r2.get(key), /HTTP 302/);
    s3.next.push({ status: 200, body: '<html>não sou S3</html>', contentType: 'text/html' });
    await expectUnavailable(r2.list(), /não é uma listagem/);
    s3.next.push({ status: 500 });
    await expectUnavailable(r2.delete(key));
    // Ausência de verdade continua sendo resposta, não erro.
    expect(await r2.get(`p/${'b'.repeat(64)}.webp`)).toBeNull();
  });

  it('nenhum erro carrega segredo, chave de acesso, assinatura ou o endereço do endpoint', () => {
    expect(errors.length).toBeGreaterThan(5);
    for (const error of errors) {
      const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
      for (const forbidden of [SECRET, ACCESS, 'Signature=', 'Credential=', s3.endpoint]) expect(text).not.toContain(forbidden);
    }
  });
});

/* ================================================================== mapa */

describe('mapa de migração (referência antiga → SHA-256 → chave), persistente', () => {
  it('sobrevive a um "reinício": outra instância lê exatamente o mesmo estado', async () => {
    const map = newMap();
    const body = await image();
    const ref = writeMedia('mapa-reinicio.webp', body);
    await migrateObjects(inventory([ref], resolveImageFile), { remote: new FakeR2StorageProvider(), map });
    const again = new MediaMap(map.file);
    expect(again.read()).toEqual(map.read());
    expect(again.validatedKeyFor(ref)).toBe(contentAddress(body).key);
    expect(again.originalsFor(contentAddress(body).key)).toEqual([ref]);
  });

  it('arquivo ilegível ou inválido é ERRO — nunca vira "mapa vazio" (que esconderia uma migração)', () => {
    const map = newMap();
    writeFileSync(map.file, '{ quebrado');
    expect(() => map.read()).toThrow(MediaMapError);
    writeFileSync(map.file, JSON.stringify({ version: 1, updatedAt: 'x', objects: { 'media/x.webp': {} }, refs: {}, journal: [] }));
    expect(() => new MediaMap(map.file).read()).toThrow(MediaMapError);
  });

  it('seis PROCESSOS gravando ao mesmo tempo: nenhuma atualização perdida (trava de arquivo)', async () => {
    const map = newMap();
    const script = path.join(work, 'map-writer.mts');
    const mapUrl = new URL('../apps/server/src/media/map.ts', import.meta.url).href;
    writeFileSync(
      script,
      `import { MediaMap } from '${mapUrl}';
const [file, prefix, n] = process.argv.slice(2);
const map = new MediaMap(file);
const key = 'p/' + '${'c'.repeat(64)}' + '.webp';
await Promise.all(Array.from({ length: Number(n) }, (_, i) => map.update((d) => {
  d.objects[key] = { sha256: '${'c'.repeat(64)}', bytes: 1, contentType: 'image/webp', status: 'validated', validatedAt: new Date().toISOString(), storage: 'fake' };
  d.refs['media/' + prefix + '-' + i + '.webp'] = { key, sha256: '${'c'.repeat(64)}', recordedAt: new Date().toISOString() };
})));
`,
    );
    const run = (prefix: string) =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', script, map.file, prefix, '25'], { cwd: process.cwd() }).catch((error: { stderr?: string }) => {
        throw new Error(`processo ${prefix} falhou: ${String(error.stderr ?? error).slice(-800)}`);
      });
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(run));
    const refs = Object.keys(new MediaMap(map.file).read().refs);
    expect(refs).toHaveLength(6 * 25);
    expect(existsSync(`${map.file}.lock`)).toBe(false);
  }, 60_000);

  it('trava abandonada (processo que morreu) é retomada; trava viva faz esperar e desistir SEM gravar', async () => {
    const map = newMap();
    await map.update((d) => void d);
    const before = readFileSync(map.file, 'utf8');
    writeFileSync(`${map.file}.lock`, '99999 velho');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(`${map.file}.lock`, old, old);
    await map.update((d) => void d.journal.push({ at: 'agora', kind: 'rollback', changes: [] }));
    expect(new MediaMap(map.file).read().journal).toHaveLength(1);
    const busy = new MediaMap(map.file, { lockTimeoutMs: 150 });
    writeFileSync(`${map.file}.lock`, `${process.pid} vivo`);
    const snapshot = readFileSync(map.file, 'utf8');
    await expect(busy.update((d) => void d.journal.push({ at: 'x', kind: 'rollback', changes: [] }))).rejects.toThrow(MediaMapError);
    expect(readFileSync(map.file, 'utf8')).toBe(snapshot);
    expect(snapshot).not.toBe(before);
  });
});

/* ================================================================== upload com prova e falhas parciais */

describe('upload com prova (SHA-256 de volta) e falhas parciais', () => {
  async function three() {
    return Promise.all([1, 2, 3].map(async (i) => writeMedia(`prova-${color}-${i}.webp`, await image())));
  }

  it('sobe, BAIXA DE VOLTA, confere o SHA-256 e só então marca "validated"; as referências apontam para a chave', async () => {
    const refs = await three();
    const remote = new FakeR2StorageProvider();
    const map = newMap();
    const report = await migrateObjects(inventory(refs, resolveImageFile), { remote, map });
    expect(report).toMatchObject({ ok: true, failed: [] });
    expect(report.uploaded).toHaveLength(3);
    expect(remote.calls.get).toBeGreaterThanOrEqual(3);
    for (const ref of refs) {
      const key = map.validatedKeyFor(ref)!;
      expect(sha((await remote.get(key))!.body)).toBe(sha(readFileSync(resolveImageFile(ref)!)));
      expect(map.read().objects[key]).toMatchObject({ status: 'validated', storage: 'fake-r2' });
    }
  });

  it.each([
    ['put indisponível', (r: FakeR2StorageProvider) => r.fail('put', 'unavailable'), /destino indisponível/],
    ['put sem resposta (timeout)', (r: FakeR2StorageProvider) => r.fail('put', 'timeout'), /sem resposta/],
    ['upload "aceito" e perdido (objeto não existe depois)', (r: FakeR2StorageProvider) => r.fail('put', 'drop'), /ausente logo depois do upload/],
    ['upload interrompido (metade do conteúdo)', (r: FakeR2StorageProvider) => r.fail('put', 'truncate'), /SHA-256 divergente/],
    ['get devolve conteúdo corrompido', (r: FakeR2StorageProvider) => r.fail('get', 'corrupt'), /SHA-256 divergente/],
    ['get indisponível', (r: FakeR2StorageProvider) => r.fail('get', 'unavailable'), /destino indisponível/],
    ['get diz que não existe', (r: FakeR2StorageProvider) => r.fail('get', 'missing'), /ausente logo depois/],
  ])('%s → NÃO validado, fora do mapa; os outros objetos seguem', async (_name, inject, reason) => {
    const refs = await three();
    const items = inventory(refs, resolveImageFile);
    const remote = new FakeR2StorageProvider();
    inject(remote);
    const map = newMap();
    const report = await migrateObjects(items, { remote, map, concurrency: 1 });
    expect(report.ok).toBe(false);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]!.reason).toMatch(reason);
    const failedKey = report.failed[0]!.key;
    expect(map.isValidated(failedKey)).toBe(false);
    expect(map.read().refs[report.failed[0]!.refs[0]!]).toBeUndefined();
    expect(report.uploaded).toHaveLength(2);
    // Objeto com conteúdo errado sob uma chave por conteúdo não fica lá.
    const left = remote.objects.get(failedKey);
    if (left) expect(sha(left.body)).toBe(shaOfContentKey(failedKey));
    // A virada fica bloqueada inteira: nenhuma referência muda.
    const lib = tinyLibrary(refs.map((url, i) => ({ product: `p${i}`, url })));
    const plan = planCutover(lib, map.read());
    expect(plan.ok).toBe(false);
    expect(plan.changes).toEqual([]);
    expect(plan.blocked.map((b) => b.ref)).toEqual(report.failed[0]!.refs);
  });

  it('arquivo trocado entre o inventário e o upload: recusado, nada sobe', async () => {
    const ref = writeMedia(`trocado-${color}.webp`, await image());
    const items = inventory([ref], resolveImageFile);
    writeFileSync(resolveImageFile(ref)!, await image());
    const remote = new FakeR2StorageProvider();
    const report = await migrateObjects(items, { remote, map: newMap() });
    expect(report.ok).toBe(false);
    expect(remote.calls.put).toBe(0);
  });

  it('segunda rodada: tudo já provado → nenhum upload; objeto que SUMIU do destino é enviado e provado de novo', async () => {
    const refs = await three();
    const items = inventory(refs, resolveImageFile);
    const remote = new FakeR2StorageProvider();
    const map = newMap();
    await migrateObjects(items, { remote, map });
    const puts = remote.calls.put;
    const again = await migrateObjects(items, { remote, map });
    expect(again).toMatchObject({ ok: true, uploaded: [] });
    expect(again.skipped).toHaveLength(3);
    expect(remote.calls.put).toBe(puts);
    const lost = items[0]!.key!;
    remote.objects.delete(lost);
    const third = await migrateObjects(items, { remote, map });
    expect(third.uploaded).toEqual([lost]);
    expect(remote.objects.has(lost)).toBe(true);
  });
});

/* ================================================================== concorrência */

describe('concorrência', () => {
  it('10 uploads simultâneos do MESMO conteúdo (referências diferentes) → 1 objeto, 1 chave, as 10 referências no mapa', async () => {
    const body = await image();
    const refs = Array.from({ length: 10 }, (_, i) => writeMedia(`igual-${color}-${i}.webp`, body));
    const remote = new FakeR2StorageProvider();
    remote.latencyMs = 15;
    const map = newMap();
    const reports = await Promise.all(refs.map((ref) => migrateObjects(inventory([ref], resolveImageFile), { remote, map })));
    expect(reports.every((r) => r.ok)).toBe(true);
    expect(remote.calls.put).toBe(1);
    expect(remote.objects.size).toBe(1);
    const key = contentAddress(body).key;
    expect(map.originalsFor(key)).toEqual([...refs].sort());
    expect(new Set(refs.map((r) => map.validatedKeyFor(r)))).toEqual(new Set([key]));
  });

  it('10 conteúdos diferentes em paralelo → 10 objetos, 10 chaves, mapa completo', async () => {
    const refs = await Promise.all(Array.from({ length: 10 }, async (_, i) => writeMedia(`diferente-${color}-${i}.webp`, await image())));
    const remote = new FakeR2StorageProvider();
    remote.latencyMs = 15;
    const map = newMap();
    const reports = await Promise.all(refs.map((ref) => migrateObjects(inventory([ref], resolveImageFile), { remote, map })));
    expect(reports.every((r) => r.ok)).toBe(true);
    expect(remote.objects.size).toBe(10);
    expect(Object.keys(map.read().objects)).toHaveLength(10);
    expect(Object.keys(map.read().refs)).toHaveLength(10);
  });

  it('duas migrações simultâneas da MESMA referência → um upload, uma entrada, nada parcial', async () => {
    const ref = writeMedia(`mesma-${color}.webp`, await image());
    const remote = new FakeR2StorageProvider();
    remote.latencyMs = 20;
    const map = newMap();
    const [a, b] = await Promise.all([migrateObjects(inventory([ref], resolveImageFile), { remote, map }), migrateObjects(inventory([ref], resolveImageFile), { remote, map })]);
    expect(a.ok && b.ok).toBe(true);
    expect(remote.calls.put).toBe(1);
    expect(Object.keys(map.read().refs)).toEqual([ref]);
    expect(Object.keys(map.read().objects)).toHaveLength(1);
  });
});

/* ================================================================== dry-run */

describe('dry-run', () => {
  it('não grava nada no destino e mostra: total, SHA-256, chaves, existentes, duplicatas, referências a mudar, faltantes, divergências', async () => {
    const same = await image();
    const refs = {
      a: writeMedia(`dry-a-${color}.webp`, same),
      dup: writeMedia(`dry-dup-${color}.webp`, same),
      novo: writeMedia(`dry-novo-${color}.webp`, await image()),
      provado: writeMedia(`dry-provado-${color}.webp`, await image()),
      noDestino: writeMedia(`dry-destino-${color}.webp`, await image()),
      divergente: writeMedia(`dry-div-${color}.webp`, await image()),
    };
    const remote = new FakeR2StorageProvider();
    const map = newMap();
    // Já provado antes (mapa) e já no destino sem prova (subido por fora).
    await migrateObjects(inventory([refs.provado], resolveImageFile), { remote, map });
    const onlyRemote = inventory([refs.noDestino], resolveImageFile)[0]!;
    await remote.put(onlyRemote.key!, readFileSync(onlyRemote.file!), { contentType: 'image/webp' });
    const counts = { ...remote.calls };
    const expected = new Map([[refs.divergente, 'd'.repeat(64)]]);
    const all = [...Object.values(refs), 'media/nao-existe.webp', 'https://loja.exemplo.test/foto.webp', contentAddress(same).key];
    const report = await dryRun(inventory(all, resolveImageFile, expected), map.read(), remote);
    expect(remote.calls.put).toBe(counts.put);
    expect(remote.calls.delete).toBe(counts.delete);
    expect(report).toMatchObject({ dryRun: true, total: 9, remoteChecked: true, duplicatesAvoided: 1, missing: ['media/nao-existe.webp'] });
    expect(report.divergences.map((d) => d.ref)).toEqual([refs.divergente]);
    expect(report.alreadyValidated).toEqual([map.validatedKeyFor(refs.provado)]);
    expect(report.existingRemote).toEqual([onlyRemote.key]);
    expect(report.keysToCreate.sort()).toEqual([contentAddress(same).key, inventory([refs.novo], resolveImageFile)[0]!.key].sort());
    expect(report.refsToChange.map((r) => r.ref).sort()).toEqual([refs.a, refs.dup, refs.novo, refs.provado, refs.noDestino].sort());
    const state = (ref: string) => report.files.find((f) => f.ref === ref)?.state;
    expect(state('https://loja.exemplo.test/foto.webp')).toBe('externa');
    expect(state(contentAddress(same).key)).toBe('já por conteúdo');
    for (const f of report.files.filter((x) => x.key && x.state !== 'já por conteúdo')) expect(f.key).toBe(`p/${f.sha256}.webp`);
  });

  it('arquivo alterado depois de migrado aparece como divergente (o mapa guarda outro SHA-256)', async () => {
    const ref = writeMedia(`mudou-${color}.webp`, await image());
    const map = newMap();
    await migrateObjects(inventory([ref], resolveImageFile), { remote: new FakeR2StorageProvider(), map });
    writeFileSync(resolveImageFile(ref)!, await image());
    const report = await dryRun(inventory([ref], resolveImageFile), map.read(), null);
    expect(report.remoteChecked).toBe(false);
    expect(report.divergences.map((d) => d.ref)).toEqual([ref]);
  });
});

/* ================================================================== virada e volta */

describe('virada e volta das referências (puras, tudo-ou-nada)', () => {
  async function migrated(n: number) {
    const refs = await Promise.all(Array.from({ length: n }, async (_, i) => writeMedia(`virada-${color}-${i}.webp`, await image())));
    const map = newMap();
    const report = await migrateObjects(inventory(refs, resolveImageFile), { remote: new FakeR2StorageProvider(), map });
    expect(report.ok).toBe(true);
    return { refs, map };
  }

  it('virada completa e volta pelo DIÁRIO devolvem a biblioteca idêntica', async () => {
    const { refs, map } = await migrated(5);
    const lib = tinyLibrary([
      { product: 'a', url: refs[0]!, thumbUrl: refs[1]!, masterUrl: refs[2]! },
      { product: 'b', url: refs[3]! },
    ], refs[4]!);
    const plan = planCutover(lib, map.read());
    expect(plan.ok).toBe(true);
    expect(plan.changes).toHaveLength(5);
    const after = applyRefChanges(lib, plan.changes);
    expect(refLocations(after).every((l) => isContentKey(l.ref))).toBe(true);
    await map.update((d) => void d.journal.push({ at: new Date().toISOString(), kind: 'cutover', changes: plan.changes }));
    const back = planRollback(after, map.read(), resolveImageFile);
    expect(back.ok).toBe(true);
    expect(applyRefChanges(after, back.changes)).toEqual(lib);
  });

  it('volta SEM diário: pelo mapa quando há uma só origem; mesmo conteúdo em duas origens = ambíguo, bloqueia tudo', async () => {
    const body = await image();
    const one = writeMedia(`amb-1-${color}.webp`, body);
    const two = writeMedia(`amb-2-${color}.webp`, body);
    const solo = writeMedia(`solo-${color}.webp`, await image());
    const map = newMap();
    await migrateObjects(inventory([one, two, solo], resolveImageFile), { remote: new FakeR2StorageProvider(), map });
    const soloOnly = applyRefChanges(tinyLibrary([{ product: 's', url: solo }]), planCutover(tinyLibrary([{ product: 's', url: solo }]), map.read()).changes);
    const soloBack = planRollback(soloOnly, map.read(), resolveImageFile);
    expect(soloBack.ok).toBe(true);
    expect(soloBack.changes[0]!.to).toBe(solo);
    const both = tinyLibrary([{ product: 'x', url: one }, { product: 's', url: solo }]);
    const after = applyRefChanges(both, planCutover(both, map.read()).changes);
    const blocked = planRollback(after, map.read(), resolveImageFile);
    expect(blocked.ok).toBe(false);
    expect(blocked.changes).toEqual([]);
    expect(blocked.blocked[0]!.reason).toMatch(/ambíguo/);
  });

  it('a volta exige o arquivo local com o SHA-256 da chave: ausente ou trocado bloqueia', async () => {
    const { refs, map } = await migrated(1);
    const lib = tinyLibrary([{ product: 'a', url: refs[0]! }]);
    const after = applyRefChanges(lib, planCutover(lib, map.read()).changes);
    writeFileSync(resolveImageFile(refs[0]!)!, await image());
    const plan = planRollback(after, map.read(), resolveImageFile);
    expect(plan.ok).toBe(false);
    expect(plan.blocked[0]!.reason).toMatch(/ausente ou diferente/);
  });

  it('plano velho não sobrescreve referência que mudou depois', async () => {
    const { refs, map } = await migrated(1);
    const lib = tinyLibrary([{ product: 'a', url: refs[0]! }]);
    const plan = planCutover(lib, map.read());
    const changed = applyRefChanges(lib, [{ ...plan.changes[0]!, to: 'media/outra.webp' } as RefChange]);
    expect(() => applyRefChanges(changed, plan.changes)).toThrow(/mudou desde o plano/);
  });
});

/* ================================================================== seedUpgrades */

describe('seedUpgrades com o R2 — idempotente, nada volta para bottles/', () => {
  const seed = (JSON.parse(readFileSync('apps/web/src/data/seed.json', 'utf8')) as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
  const apply = (current: Perfume[], upgrades: Perfume[]) => current.map((p) => upgrades.find((u) => u.id === p.id) ?? p);
  /** Mapa com as fotos REAIS da semente (apps/web/public/bottles, só leitura) provadas num R2 falso. */
  async function seedMigrated() {
    const refs = seed.flatMap((p) => [p.imageUrl, p.thumbUrl, p.masterUrl]).filter((r): r is string => Boolean(r));
    const map = newMap();
    const remote = new FakeR2StorageProvider();
    const report = await migrateObjects(inventory(refs, resolveImageFile), { remote, map });
    expect(report.ok).toBe(true);
    return { map, remote };
  }
  const cutover = (list: Perfume[], map: MediaMap) =>
    list.map((p) => ({ ...p, imageUrl: p.imageUrl && map.validatedKeyFor(p.imageUrl), thumbUrl: p.thumbUrl && map.validatedKeyFor(p.thumbUrl), masterUrl: p.masterUrl && map.validatedKeyFor(p.masterUrl) }));

  it('sem R2: 1ª execução atualiza, 2ª e 3ª não mudam nada', () => {
    const old = seed.map((p, i) => (i < 3 ? { ...p, assetVersion: p.assetVersion - 1 } : p));
    const first = seedUpgrades(old, seed);
    expect(first.length).toBe(3);
    const after = apply(old, first);
    expect(seedUpgrades(after, seed)).toEqual([]);
    expect(seedUpgrades(after, seed)).toEqual([]);
  });

  it('fotos da semente JÁ migradas (banco com p/…): 3 execuções no modo r2 e no local não mudam nada nem sobem nada', async () => {
    const { map, remote } = await seedMigrated();
    const current = cutover(seed, map);
    expect(current.every((p) => !p.imageUrl || isContentKey(p.imageUrl))).toBe(true);
    const puts = remote.calls.put;
    for (const backend of ['r2', 'local'] as const) {
      const refs = seedRefs(settingsFor(backend, remote, map));
      for (let i = 0; i < 3; i++) expect(seedUpgrades(current, seed, refs)).toEqual([]);
    }
    expect(remote.calls.put).toBe(puts);
  });

  it('semente mais nova no modo r2: foto já migrada é gravada como CHAVE (não volta para bottles/); depois fica estável', async () => {
    const { map, remote } = await seedMigrated();
    const current = cutover(seed, map);
    const newer = seed.map((p, i) => (i === 0 ? { ...p, assetVersion: p.assetVersion + 1 } : p));
    const refs = seedRefs(settingsFor('r2', remote, map));
    const first = seedUpgrades(current, newer, refs);
    expect(first).toHaveLength(1);
    expect(isContentKey(first[0]!.imageUrl)).toBe(true);
    expect(first[0]!.imageUrl).toBe(current[0]!.imageUrl);
    const after = apply(current, first);
    expect(seedUpgrades(after, newer, refs)).toEqual([]);
    expect(seedUpgrades(after, newer, refs)).toEqual([]);
  });

  it('semente com FOTO NOVA ainda não migrada no modo r2: grava a referência local uma vez; depois fica estável', async () => {
    const { map, remote } = await seedMigrated();
    const current = cutover(seed, map);
    const other = seed[1]!.imageUrl!;
    const newer = seed.map((p, i) => (i === 0 ? { ...p, assetVersion: p.assetVersion + 1, imageUrl: other } : p));
    // A foto "nova" existe no mapa (é de outro perfume); para ser NOVA de verdade, tira do mapa uma referência inexistente.
    const brandNew = 'bottles/foto-nova-inexistente.webp';
    const newer2 = newer.map((p, i) => (i === 0 ? { ...p, imageUrl: brandNew } : p));
    const refs = seedRefs(settingsFor('r2', remote, map));
    const first = seedUpgrades(current, newer2, refs);
    expect(first[0]!.imageUrl).toBe(brandNew);
    const after = apply(current, first);
    expect(seedUpgrades(after, newer2, refs)).toEqual([]);
    expect(seedUpgrades(after, newer2, refs)).toEqual([]);
  });
});

/* ================================================================== fallback, rota /p/, CSP, Open Graph, service worker */

describe('servir /p/<sha256>: R2, fallback controlado, cópia local', () => {
  let key = '';
  let ref = '';
  let body: Buffer;
  let map: MediaMap;
  let remote: FakeR2StorageProvider;
  let pending = '';

  beforeAll(async () => {
    body = await image();
    ref = writeMedia(`rota-${color}.webp`, body);
    map = newMap();
    remote = new FakeR2StorageProvider();
    await migrateObjects(inventory([ref], resolveImageFile), { remote, map });
    key = contentAddress(body).key;
    const other = writeMedia(`rota-pendente-${color}.webp`, await image());
    pending = contentAddress(readFileSync(resolveImageFile(other)!)).key;
    // Pendente: referência registrada no mapa SEM objeto validado (upload falhou).
    remote.fail('put', 'unavailable');
    await migrateObjects(inventory([other], resolveImageFile), { remote, map });
    await map.update((d) => void (d.refs[other] = { key: pending, sha256: shaOfContentKey(pending)!, recordedAt: 'x' }));
  });

  it('r2 + validada → redireciona para a URL pública do R2', () => {
    expect(routeContentKey(key, settingsFor('r2', remote, map))).toEqual({ kind: 'redirect', location: `https://img.exemplo.test/${key}` });
  });

  it('r2 + NÃO validada, sem fallback → 404 com log de ERRO (a migração incompleta aparece)', () => {
    const spy = vi.spyOn(log, 'error');
    expect(routeContentKey(pending, settingsFor('r2', remote, map))).toEqual({ kind: 'missing', reason: 'not_migrated' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'media.not_migrated', key: pending }));
    spy.mockRestore();
  });

  it('r2 + NÃO validada, MEDIA_FALLBACK=local → cópia local conferida, com log de AVISO', () => {
    const spy = vi.spyOn(log, 'warn');
    const route = routeContentKey(pending, settingsFor('r2', remote, map, 'local'));
    expect(route).toMatchObject({ kind: 'local', fallback: true });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'media.fallback', key: pending, served: 'local' }));
    spy.mockRestore();
  });

  it('modo local: a chave vira o arquivo local de origem (conferido); arquivo trocado não serve', async () => {
    const route = routeContentKey(key, settingsFor('local', null, map));
    expect(route.kind).toBe('local');
    expect(sha(readFileSync((route as { file: string }).file))).toBe(sha(body));
    const copy = writeMedia(`rota-troca-${color}.webp`, body);
    await map.update((d) => void (d.refs[copy] = { key, sha256: sha(body), recordedAt: 'x' }));
    writeFileSync(resolveImageFile(copy)!, await image());
    expect(localFileForKey(key, map)!.ref).toBe(ref);
  });

  it('pelo HTTP: 302 para o R2, 404 sem fallback, bytes idênticos pela cópia local; CSP local igual ao de sempre', async () => {
    const { createHandler } = await import('../apps/server/src/http/app');
    const { loadStore, store } = await import('../apps/server/src/store');
    loadStore();
    let current = createHandler({ repo: store, content: settingsFor('r2', remote, map) });
    const server = http.createServer((req, res) => void current(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    process.env.PERFUMES_PORT = String(port);
    reloadConfig();
    const get = (p: string) => fetch(`http://localhost:${port}${p}`, { redirect: 'manual' });
    try {
      const redirect = await get(`/${key}`);
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('location')).toBe(`https://img.exemplo.test/${key}`);
      expect(redirect.headers.get('content-security-policy')).toContain("img-src 'self' data: blob: https://img.exemplo.test;");
      expect((await get(`/${pending}`)).status).toBe(404);
      expect((await get('/p/../../package.json')).status).toBe(404);
      current = createHandler({ repo: store, content: settingsFor('r2', remote, map, 'local') });
      const fallback = await get(`/${pending}`);
      expect(fallback.status).toBe(200);
      current = createHandler({ repo: store, content: settingsFor('local', null, map) });
      const local = await get(`/${key}`);
      expect(local.status).toBe(200);
      expect(local.headers.get('content-type')).toBe('image/webp');
      expect(sha(Buffer.from(await local.arrayBuffer()))).toBe(sha(body));
      const home = await get('/');
      expect([200, 503]).toContain(home.status);
      expect((await get('/api/perfumes')).status).toBe(200);
      // "Reinício": handler novo, mapa relido do arquivo — o R2 validado continua redirecionando.
      current = createHandler({ repo: store, content: settingsFor('r2', remote, new MediaMap(map.file)) });
      expect((await get(`/${key}`)).status).toBe(302);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('CSP img-src', () => {
  const LEGACY = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  it('modo local: exatamente a política de antes (nenhum domínio novo)', () => {
    expect(contentSecurityPolicy(settingsFor('local', null, newMap()))).toBe(LEGACY);
  });
  it('modo r2: libera SÓ a origem pública configurada (sem caminho, sem curinga)', () => {
    const csp = contentSecurityPolicy(settingsFor('r2', new FakeR2StorageProvider('https://img.exemplo.test/fotos'), newMap()));
    expect(csp).toBe(LEGACY.replace("img-src 'self' data: blob:;", "img-src 'self' data: blob: https://img.exemplo.test;"));
    expect(csp).not.toMatch(/\*|http:|r2\.cloudflarestorage/);
  });
  it('a origem vem só da configuração validada: http, credenciais, ? e # são recusados no start', async () => {
    const { parseEnv, ConfigError } = await import('../apps/server/src/config');
    const r2 = { MEDIA_BACKEND: 'r2', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'y', R2_BUCKET: 'perfumes-teste', R2_ENDPOINT: 'https://conta.exemplo.test' };
    expect(parseEnv({ ...r2, R2_PUBLIC_BASE_URL: 'https://img.exemplo.test' }).MEDIA_BACKEND).toBe('r2');
    for (const bad of ['http://img.exemplo.test', 'https://u:p@img.exemplo.test', 'https://img.exemplo.test/?a=1', 'https://img.exemplo.test/#x', 'img.exemplo.test']) {
      expect(() => parseEnv({ ...r2, R2_PUBLIC_BASE_URL: bad })).toThrow(ConfigError);
    }
  });
});

describe('Open Graph', () => {
  const repoWith = (imageUrl: string) =>
    ({
      publicProfile: async () => ({ user: { username: 'ana', displayName: 'Ana' }, lists: ['wishlist'] }),
      publicList: async () => [{ name: 'Teste', imageUrl }],
    }) as never;
  it('local: a imagem pelo próprio servidor, como sempre; r2 + validada: a URL pública do R2; r2 sem prova: pelo servidor', async () => {
    const { publicPageMeta } = await import('../apps/server/src/http/seo');
    const body = await image();
    const ref = writeMedia(`og-${color}.webp`, body);
    const map = newMap();
    const remote = new FakeR2StorageProvider();
    await migrateObjects(inventory([ref], resolveImageFile), { remote, map });
    const key = contentAddress(body).key;
    const route = { username: 'ana', list: 'wishlist' as const };
    expect((await publicPageMeta(route, 'http://localhost:3100', repoWith('bottles/x.webp'), settingsFor('local', null, map))).image).toBe('http://localhost:3100/bottles/x.webp');
    expect((await publicPageMeta(route, 'http://localhost:3100', repoWith(key), settingsFor('r2', remote, map))).image).toBe(`https://img.exemplo.test/${key}`);
    expect((await publicPageMeta(route, 'http://localhost:3100', repoWith(key), settingsFor('local', null, map))).image).toBe(`http://localhost:3100/${key}`);
    const unproven = `p/${'9'.repeat(64)}.webp`;
    expect(absoluteImageUrl(unproven, 'https://perfumes.exemplo.test', settingsFor('r2', remote, map))).toBe(`https://perfumes.exemplo.test/${unproven}`);
  });
});

describe('service worker', () => {
  /** Roda o sw.js de verdade num contexto falso e diz quais pedidos ele intercepta. */
  function loadSw() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const store = new Map<string, Map<string, Response>>();
    const cache = (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return { match: async (r: { url: string }) => m.get(r.url), put: async (r: { url: string }, res: Response) => void m.set(r.url, res), keys: async () => [...m.keys()].map((url) => ({ url })), delete: async (r: { url: string }) => m.delete(r.url) };
    };
    const self = { addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn), location: { origin: 'http://localhost:3100' }, skipWaiting: () => {}, clients: { claim: () => {} } };
    vm.runInNewContext(readFileSync('apps/web/public/sw.js', 'utf8'), { self, caches: { open: async (n: string) => cache(n), keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n) }, fetch: async () => new Response('x'), URL, Response, Promise, console });
    const pending: Promise<unknown>[] = [];
    const intercepts = (url: string, mode = 'no-cors') => {
      let handled = false;
      listeners.fetch!({ request: { url, method: 'GET', mode }, respondWith: (p: Promise<unknown>) => ((handled = true), pending.push(p)) });
      return handled;
    };
    return { intercepts, store, settle: () => Promise.all(pending) };
  }

  it('fotos locais continuam no cache; /p/… (redirecionado ao R2) e a URL do R2 NÃO passam pelo cache do app', () => {
    const { intercepts } = loadSw();
    expect(intercepts('http://localhost:3100/bottles/a.webp')).toBe(true);
    expect(intercepts('http://localhost:3100/media/a.webp')).toBe(true);
    expect(intercepts(`http://localhost:3100/p/${'a'.repeat(64)}.webp`)).toBe(false);
    expect(intercepts(`https://img.exemplo.test/p/${'a'.repeat(64)}.webp`)).toBe(false);
  });

  it('o cache de fotos tem teto (300): referência antiga não fica presa para sempre', async () => {
    const { intercepts, store, settle } = loadSw();
    for (let i = 0; i < 305; i++) intercepts(`http://localhost:3100/media/f${i}.webp`);
    await settle();
    const images = [...store.entries()].find(([n]) => n.startsWith('mp-images-'))![1];
    expect(images.size).toBeLessThanOrEqual(300);
    expect(images.has('http://localhost:3100/media/f0.webp')).toBe(false);
  });
});

/* ================================================================== resolveImageFile, importer, fotos novas, limpeza */

describe('resolveImageFile, importer e fotos novas no modo r2', () => {
  it('resolveImageFile: bottles/ e media/ como antes; p/… vira o arquivo local conferido pelo mapa oficial', async () => {
    expect(resolveImageFile('bottles/x.webp')).toBe(path.join(config.root, 'apps', 'web', 'public', 'bottles', 'x.webp'));
    expect(resolveImageFile('media/x.webp')).toBe(path.join(dataDir, 'media', 'x.webp'));
    const body = await image();
    const ref = writeMedia(`resolve-${color}.webp`, body);
    const key = contentAddress(body).key;
    expect(resolveImageFile(key)).toBeNull();
    await migrateObjects(inventory([ref], resolveImageFile), { remote: new FakeR2StorageProvider(), map: new MediaMap(config.mediaMapFile) });
    expect(resolveImageFile(key)).toBe(path.join(dataDir, 'media', path.basename(ref)));
    expect(resolveImageFile(`p/${'0'.repeat(64)}.webp`)).toBeNull();
  });

  it('importer: biblioteca já virada (p/…) valida e importa num Postgres descartável; sha256 do banco = SHA-256 da chave', async () => {
    const lib = fixtureLibrary();
    // Troca cada referência por uma foto REAL (a importação confere os arquivos) e depois vira para o R2.
    const mapping = new Map<string, string>();
    for (const l of refLocations(lib)) if (!mapping.has(l.ref)) mapping.set(l.ref, writeMedia(`imp-${mapping.size}-${color}.webp`, await image()));
    const local = applyRefChanges(lib, refLocations(lib).map((l) => ({ ...l, from: l.ref, to: mapping.get(l.ref)! })));
    const map = new MediaMap(config.mediaMapFile);
    const report = await migrateObjects(inventory([...mapping.values()], resolveImageFile), { remote: new FakeR2StorageProvider(), map });
    expect(report.ok).toBe(true);
    const plan = planCutover(local, map.read());
    expect(plan.ok).toBe(true);
    const turned = applyRefChanges(local, plan.changes);
    const validation = validateLibrary(JSON.parse(JSON.stringify(turned)), resolveImageFile);
    expect(validation.problems).toEqual([]);
    expect(validation.images.every((i) => i.exists && i.sha256 === shaOfContentKey(i.ref))).toBe(true);
    const handle = await freshDb();
    try {
      const imported = await importLibrary(handle.db, validation);
      expect(imported.ok).toBe(true);
      const back = await loadLibrary(handle.db);
      expect(refLocations(back).every((l) => isContentKey(l.ref))).toBe(true);
      expect(refLocations(back).length).toBe(refLocations(turned).length);
    } finally {
      await handle.close();
    }
  });

  it('foto nova no modo r2: cópia local primeiro, depois R2 com prova; referências p/…; falha do R2 não devolve referência', async () => {
    const bottle = { master: await image('png'), large: await image(), small: await image(), color: { hex: '#123456', neutral: false }, cutout: true } as unknown as ProcessedBottle;
    const remote = new FakeR2StorageProvider();
    const map = newMap();
    const saved = await saveBottleMedia(bottle, undefined, settingsFor('r2', remote, map));
    for (const [ref, body] of [[saved.imageUrl, bottle.large], [saved.thumbUrl, bottle.small], [saved.masterUrl, bottle.master]] as const) {
      expect(ref).toBe(contentAddress(body).key);
      expect(map.isValidated(ref)).toBe(true);
      expect(sha((await remote.get(ref))!.body)).toBe(sha(body));
      expect(existsSync(path.join(dataDir, 'media', `${sha(body)}.${ref.split('.').pop()}`))).toBe(true);
    }
    const failing = new FakeR2StorageProvider().fail('put', 'unavailable', 5);
    const other = { ...bottle, large: await image(), small: await image(), master: await image('png') } as unknown as ProcessedBottle;
    await expect(saveBottleMedia(other, undefined, settingsFor('r2', failing, newMap()))).rejects.toThrow(/não foram confirmadas no R2/);
  });

  it('foto nova no modo local: exatamente como antes (nome aleatório em media/)', async () => {
    const root = mkdtempSync(path.join(work, 'local-save-'));
    const storage = new LocalStorageProvider(() => root, 'media/');
    const saved = await saveBottleMedia({ master: await image('png'), large: await image(), small: await image(), color: { hex: '#abcdef', neutral: true }, cutout: false } as unknown as ProcessedBottle, storage);
    expect(saved.imageUrl).toMatch(/^media\/[a-z0-9]+-[0-9a-f]{10}-lg\.webp$/);
    expect(saved).toMatchObject({ dominantColor: '#abcdef', neutral: true, cutout: false });
  });

  it('limpeza de órfãos: a cópia local de uma foto em uso pelo R2 NÃO vai para a lixeira', async () => {
    const root = mkdtempSync(path.join(work, 'gc-'));
    const trashDir = mkdtempSync(path.join(work, 'gc-lixeira-'));
    const storage = new LocalStorageProvider(() => root, 'media/');
    const body = await image();
    const kept = contentAddress(body);
    writeFileSync(path.join(root, `${kept.sha256}.webp`), body);
    writeFileSync(path.join(root, 'orfa.webp'), await image());
    const map = newMap();
    await map.update((d) => {
      d.objects[kept.key] = { sha256: kept.sha256, bytes: body.length, contentType: 'image/webp', status: 'validated', validatedAt: 'x', storage: 'fake' };
      d.refs[`media/${kept.sha256}.webp`] = { key: kept.key, sha256: kept.sha256, recordedAt: 'x' };
    });
    const referenced = referencedWithOriginals(new Set([kept.key]), map);
    const result = await collectMediaGarbage(referenced, 0, storage, Date.now() + 86_400_000, new LocalStorageProvider(() => trashDir, 'orfas/'));
    expect(result.removed).toBe(1);
    expect(existsSync(path.join(root, `${kept.sha256}.webp`))).toBe(true);
    expect(existsSync(path.join(root, 'orfa.webp'))).toBe(false);
    expect(existsSync(path.join(trashDir, 'orfa.webp'))).toBe(true);
  });
});

/* ================================================================== as 32 imagens reais (só leitura, R2 falso) */

describe('as 32 imagens reais do inventário, num R2 falso (nenhuma sai do computador)', () => {
  const baseline = readBaseline('docs/state/fase2-20260927/baseline.pre-fase2.json');
  const real = baseline.perfumes.flatMap((p) => p.images.map((i) => ({ ...i, perfume: p })));
  // Fotos reais: bottles/ no site, media/ nos dados REAIS do projeto (não na pasta temporária). Só leitura.
  const realFile = (ref: string) => (ref.startsWith('bottles/') ? path.join('apps', 'web', 'public', ref) : path.join('data', ref));
  const available = real.every((i) => existsSync(realFile(i.ref)));

  it.skipIf(!available)('SHA-256 → chave → upload → download → SHA-256 igual → publicUrl → volta ao arquivo idêntico; as 3 da versão 58518844047705', async () => {
    const copyRoot = mkdtempSync(path.join(work, 'reais-'));
    // Cópia para uma pasta de trabalho: o teste nunca abre as originais para escrita.
    for (const i of real) {
      mkdirSync(path.dirname(path.join(copyRoot, i.ref)), { recursive: true });
      copyFileSync(realFile(i.ref), path.join(copyRoot, i.ref));
    }
    const resolver = folderResolver(copyRoot);
    const expected = new Map(real.map((i) => [i.ref, i.sha256]));
    const items = inventory(real.map((i) => i.ref), resolver, expected);
    expect(items).toHaveLength(32);
    expect(items.filter((i) => i.problem)).toEqual([]);
    expect(items.filter((i) => i.ref.startsWith('bottles/'))).toHaveLength(26);
    expect(items.filter((i) => i.ref.startsWith('media/'))).toHaveLength(6);
    expect(items.reduce((n, i) => n + i.bytes!, 0)).toBe(real.reduce((n, i) => n + readFileSync(realFile(i.ref)).length, 0));
    for (const item of items) expect(item.key).toBe(`p/${expected.get(item.ref)}.${item.contentType === 'image/png' ? 'png' : 'webp'}`);

    const remote = new FakeR2StorageProvider();
    const map = newMap();
    const report = await migrateObjects(items, { remote, map, concurrency: 6 });
    expect(report.ok).toBe(true);
    expect(report.uploaded).toHaveLength(new Set(items.map((i) => i.key)).size);
    for (const item of items) {
      const got = (await remote.get(item.key!))!;
      expect(sha(got.body)).toBe(expected.get(item.ref));
      expect(remote.publicUrl(item.key!)).toBe(`https://img.exemplo.test/${item.key}`);
      expect(map.validatedKeyFor(item.ref)).toBe(item.key);
    }

    // A coleção real (library.json parado = mesmas 32 referências do Neon), só leitura: virada e volta idênticas.
    const library = sanitizeLibrary(JSON.parse(readFileSync(path.join('data', 'library.json'), 'utf8'))).library;
    const plan = planCutover(library, map.read());
    expect(plan.ok).toBe(true);
    expect(plan.changes).toHaveLength(32);
    const turned = applyRefChanges(library, plan.changes);
    await map.update((d) => void d.journal.push({ at: new Date().toISOString(), kind: 'cutover', changes: plan.changes }));
    const back = planRollback(turned, map.read(), resolver);
    expect(back.ok).toBe(true);
    expect(applyRefChanges(turned, back.changes)).toEqual(library);

    // Mykonos Reflection, versão 58518844047705: as 3 imagens ligadas a ela.
    const reflection = baseline.perfumes.find((p) => p.id === 'mykonos-reflection-r5rx34')!;
    expect(reflection.variantId).toBe('58518844047705');
    expect(reflection.images).toHaveLength(3);
    const product = library.products.find((p) => p.images.some((i) => i.url === reflection.images[0]!.ref))!;
    expect(product.images[0]!.variantId).toBe('58518844047705');
    for (const img of reflection.images) {
      const key = map.validatedKeyFor(img.ref)!;
      expect(sha((await remote.get(key))!.body)).toBe(img.sha256);
      const change = plan.changes.find((c) => c.from === img.ref)!;
      expect(change.to).toBe(key);
      expect(turned.products.find((p) => p.id === change.productId)!.images[0]!.variantId).toBe('58518844047705');
    }
  }, 60_000);
});
