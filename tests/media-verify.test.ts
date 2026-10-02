import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Library } from '@perfumes/core/library';
import { existsSync } from 'node:fs';
import { MediaMap } from '../apps/server/src/media/map';
import { applyRefChanges, dryRun, inventory, migrateObjects, planCutover, refLocations } from '../apps/server/src/media/migrate';
import { formatVerifyReport, verifyMedia, type ReadOnlyRemote, type VerifyReport } from '../apps/server/src/media/verify';
import type { PublicFetch } from '../apps/server/src/media/smoke';
import { FakeR2StorageProvider } from './helpers/fake-r2';
import { image, mediaResolver, networkTrap, servePublic, setupTempData, sha, tinyLibrary } from './helpers/media-fixtures';

/**
 * FASE 3.1 (hardening sem credenciais) — `media:verify`: auditoria SOMENTE DE LEITURA do banco × mapa × arquivos × R2.
 * Os estados (pré-R2, parcial, completo sem verificação, verificado, inconsistente) e cada incoerência, com R2 falso.
 */

const t = setupTempData('verify');
const resolveLocal = mediaResolver(t.dataDir);
const pkey = (c: string) => `p/${c.repeat(64)}.webp`;
let counter = 0;
let trap: ReturnType<typeof networkTrap>;
beforeEach(() => {
  trap = networkTrap();
});
afterEach(() => {
  expect(trap.offending).toEqual([]);
  trap.restore();
});

interface World {
  refs: string[];
  map: MediaMap;
  remote: FakeR2StorageProvider;
  library: Library;
  keys: string[];
}

/** n fotos reais em data/media, migradas (com prova) para um R2 falso; a biblioteca ainda aponta para os arquivos locais. */
async function world(n = 3, migrate = n): Promise<World> {
  const tag = ++counter;
  const refs: string[] = [];
  for (let i = 0; i < n; i++) refs.push(t.writeMedia(`v${tag}-${i}.webp`, await image()));
  const map = t.newMap();
  const remote = new FakeR2StorageProvider();
  const report = await migrateObjects(inventory(refs.slice(0, migrate), resolveLocal), { remote, map });
  expect(report.ok).toBe(true);
  const library = tinyLibrary(refs.map((url, i) => ({ product: `p${tag}-${i}`, url })));
  return { refs, map, remote, library, keys: [...remote.objects.keys()].sort() };
}

const run = (w: World, extra: Partial<Parameters<typeof verifyMedia>[0]> = {}): Promise<VerifyReport> =>
  verifyMedia({ map: w.map, library: w.library, resolveLocal, remote: w.remote, fetchPublic: servePublic(w.remote), ...extra });
const codes = (r: VerifyReport, severity?: string) => r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.code);

/** Lista (caminho, tamanho, data) de tudo sob as pastas dadas: prova de que nada foi criado, mudado ou apagado. */
function snapshot(...dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else out.push(`${full}|${info.size}|${info.mtimeMs}`);
    }
  };
  dirs.forEach(walk);
  return out;
}

describe('A) pré-R2: "R2 ainda não migrado"', () => {
  it('sem media-map.json e sem chaves por conteúdo no banco → pre-r2, ok, sem tocar no R2', async () => {
    const w = await world(3, 0);
    expect(existsSync(w.map.file)).toBe(false);
    const report = await verifyMedia({ map: w.map, library: w.library, resolveLocal });
    expect(report.state).toBe('pre-r2');
    expect(report.ok).toBe(true);
    expect(report.headline).toMatch(/R2 ainda não migrado/);
    expect(report.findings).toEqual([]);
    expect(existsSync(w.map.file)).toBe(false); // ler não cria o mapa
  });

  it('com o R2 à mão e o bucket vazio → continua pre-r2 (só leu: acesso e listagem de p/)', async () => {
    const w = await world(2, 0);
    const report = await run(w);
    expect(report.state).toBe('pre-r2');
    expect(report.ok).toBe(true);
    expect(w.remote.calls).toMatchObject({ put: 0, delete: 0, get: 0, access: 1, list: 1 });
    expect(w.remote.listed).toEqual(['p/']);
  });

  it('R2 inacessível não muda o estado "não migrado": vira aviso, não erro', async () => {
    const w = await world(2, 0);
    w.remote.fail('access', 'no_such_bucket');
    const report = await run(w);
    expect(report.state).toBe('pre-r2');
    expect(codes(report, 'warn')).toEqual(['remote_unreachable']);
  });

  it('objetos em p/ no R2 mas SEM mapa → inconsistente (mapa perdido?)', async () => {
    const w = await world(2, 0);
    await w.remote.put(pkey('a'), Buffer.from('x'), { contentType: 'image/webp' });
    const report = await run(w);
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toEqual(['remote_objects_without_map']);
    expect(report.ok).toBe(false);
  });

  it('banco já com chaves por conteúdo mas SEM mapa → inconsistente', async () => {
    const w = await world(1, 0);
    const library = tinyLibrary([{ product: 'x', url: pkey('b') }]);
    const report = await verifyMedia({ map: w.map, library, resolveLocal });
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toEqual(['content_refs_without_map']);
  });
});

describe('B) migração parcial', () => {
  it('2 de 3 migradas → partial, 1 pendente, ok=false', async () => {
    const w = await world(3, 2);
    const report = await run(w);
    expect(report.state).toBe('partial');
    expect(report.ok).toBe(false);
    expect(report.counts).toMatchObject({ localRefs: 3, pending: 1, mapObjects: 2 });
    expect(report.headline).toMatch(/2 de 3 referências locais/);
    expect(codes(report, 'warn')).toContain('pending_refs');
    expect(report.findings.find((f) => f.code === 'pending_refs')!.samples).toEqual([w.refs[2]]);
    expect(formatVerifyReport(report).at(-1)).toBe('RESULTADO: INCOMPLETO');
  });

  it('mapa que existe mas está vazio, com fotos no banco → partial com todas pendentes', async () => {
    const w = await world(2, 0);
    await w.map.update(() => {});
    expect(existsSync(w.map.file)).toBe(true);
    const report = await run(w);
    expect(report.state).toBe('partial');
    expect(report.counts).toMatchObject({ pending: 2, mapObjects: 0 });
  });
});

describe('C) mapa completo', () => {
  it('sem R2 para conferir → complete-unverified (o mapa afirma, ninguém provou) e NÃO é ok', async () => {
    const w = await world(3);
    const report = await verifyMedia({ map: w.map, library: w.library, resolveLocal });
    expect(report.state).toBe('complete-unverified');
    expect(report.ok).toBe(false);
    expect(report.headline).toMatch(/NÃO foram verificados/);
    expect(formatVerifyReport(report).at(-1)).toBe('RESULTADO: NÃO VERIFICADO');
  });

  it('R2 inacessível → complete-unverified com erro remote_unreachable (não "inconsistente")', async () => {
    const w = await world(3);
    w.remote.fail('access', 'access_denied');
    const report = await run(w);
    expect(report.state).toBe('complete-unverified');
    expect(codes(report, 'error')).toEqual(['remote_unreachable']);
    expect(report.ok).toBe(false);
  });

  it('todos os objetos baixados do R2 com o SHA-256 da chave (e pela URL pública) → verified', async () => {
    const w = await world(3);
    const getsBefore = w.remote.calls.get;
    const report = await run(w);
    expect(report.state).toBe('verified');
    expect(report.ok).toBe(true);
    expect(report.counts).toMatchObject({ remoteObjectsChecked: 3, publicObjectsChecked: 3, pending: 0 });
    expect(report.headline).toMatch(/3 objeto\(s\) verificados no R2 pelo SHA-256 lido de volta e 3 pela URL pública/);
    expect(report.headline).toMatch(/virada: 0 de 3/);
    expect(formatVerifyReport(report).at(-1)).toBe('RESULTADO: OK — verificado');
    expect(w.remote.calls.get - getsBefore).toBe(3); // um GET por objeto do mapa
  });

  it('sem a prova pública (--no-public) → verified, dizendo que a URL pública NÃO foi verificada', async () => {
    const w = await world(2);
    const report = await run(w, { fetchPublic: null });
    expect(report.state).toBe('verified');
    expect(report.counts.publicObjectsChecked).toBe(0);
    expect(report.headline).toMatch(/URL pública NÃO verificada/);
  });

  it('fotos repetidas (mesmo conteúdo, nomes diferentes) → 1 objeto, referências deduplicadas contadas', async () => {
    const tag = ++counter;
    const body = await image();
    const refs = [t.writeMedia(`d${tag}-a.webp`, body), t.writeMedia(`d${tag}-b.webp`, body)];
    const map = t.newMap();
    const remote = new FakeR2StorageProvider();
    await migrateObjects(inventory(refs, resolveLocal), { remote, map });
    const report = await verifyMedia({ map, library: tinyLibrary(refs.map((url, i) => ({ product: `d${i}`, url }))), resolveLocal, remote, fetchPublic: servePublic(remote) });
    expect(report.state).toBe('verified');
    expect(report.counts).toMatchObject({ mapObjects: 1, mapRefs: 2, deduplicatedRefs: 1 });
  });

  it('depois da virada (banco já com as chaves) continua verified, com a virada informada', async () => {
    const w = await world(3);
    const plan = planCutover(w.library, w.map.read());
    expect(plan.ok).toBe(true);
    const library = applyRefChanges(w.library, plan.changes);
    const report = await run(w, { library });
    expect(report.state).toBe('verified');
    expect(report.counts).toMatchObject({ contentRefs: 3, localRefs: 0, pending: 0 });
    expect(report.headline).toMatch(/virada: 3 de 3/);
  });
});

describe('inconsistências (cada uma vira erro e o estado vira inconsistent)', () => {
  it('objeto validado no mapa que NÃO existe no R2', async () => {
    const w = await world(3);
    w.remote.objects.delete(w.keys[1]!);
    const report = await run(w);
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toContain('remote_object_missing');
    expect(report.findings.find((f) => f.code === 'remote_object_missing')!.samples).toEqual([w.keys[1]]);
  });

  it('objeto no R2 com conteúdo diferente do que a chave promete (corrompido)', async () => {
    const w = await world(3);
    const obj = w.remote.objects.get(w.keys[0]!)!;
    w.remote.objects.set(w.keys[0]!, { ...obj, body: await image('webp', [1, 2, 3]) });
    const report = await run(w);
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toContain('remote_sha_mismatch');
  });

  it('objeto inesperado em p/ e sobra de healthcheck/: só AVISO, nada é apagado', async () => {
    const w = await world(2);
    await w.remote.put(pkey('e'), Buffer.from('x'), { contentType: 'image/webp' });
    await w.remote.put('healthcheck/antigo/probe.txt', Buffer.from('x'), { contentType: 'text/plain' });
    const report = await run(w);
    expect(report.state).toBe('verified');
    expect(codes(report, 'warn').sort()).toEqual(['healthcheck_leftover', 'remote_unexpected_object']);
    expect(w.remote.deleted).toEqual([]);
    expect(w.remote.objects.has(pkey('e'))).toBe(true);
  });

  it('um objeto não pôde ser lido (R2 indisponível) → erro remote_read_failed e NÃO "verified"', async () => {
    const w = await world(3);
    w.remote.fail('get', 'unavailable', 1);
    const report = await run(w);
    expect(report.state).toBe('complete-unverified');
    expect(codes(report, 'error')).toEqual(['remote_read_failed']);
    expect(report.ok).toBe(false);
  });

  it('pela URL pública o objeto não aparece (acesso público desligado) → erro public_not_found', async () => {
    const w = await world(2);
    const closed: PublicFetch = async () => new Response('x', { status: 404 });
    const report = await run(w, { fetchPublic: closed });
    expect(report.state).toBe('inconsistent');
    const finding = report.findings.find((f) => f.code === 'public_not_found')!;
    expect(finding.count).toBe(2);
    expect(finding.detail).toMatch(/acesso público do bucket está desligado|domínio aponta para outro bucket/);
  });

  it('arquivo local trocado depois de migrado → local_file_diverges', async () => {
    const w = await world(2);
    writeFileSync(resolveLocal(w.refs[0]!)!, await image('webp', [9, 9, 9]));
    const report = await run(w);
    expect(report.state).toBe('inconsistent');
    expect(report.findings.find((f) => f.code === 'local_file_diverges')!.samples).toEqual([w.refs[0]]);
  });

  it('arquivo local de origem sumiu → só AVISO (a volta dessa foto não seria possível)', async () => {
    const w = await world(2);
    unlinkSync(resolveLocal(w.refs[1]!)!);
    const report = await run(w);
    expect(report.state).toBe('verified');
    expect(codes(report, 'warn')).toEqual(['local_file_missing']);
  });

  it('SHA-256 registrado no banco diferente do mapa → db_sha_mismatch; igual → nada', async () => {
    const w = await world(2);
    const good = new Map<string, string | null>([[w.refs[0]!, w.map.read().refs[w.refs[0]!]!.sha256]]);
    expect(codes(await run(w, { expectedSha: good }))).not.toContain('db_sha_mismatch');
    const bad = await run(w, { expectedSha: new Map([[w.refs[0]!, 'f'.repeat(64)]]) });
    expect(bad.state).toBe('inconsistent');
    expect(codes(bad, 'error')).toEqual(['db_sha_mismatch']);
  });

  it('banco com chave por conteúdo que o mapa não validou → content_ref_not_validated', async () => {
    const w = await world(2);
    const library = tinyLibrary([...w.refs.map((url, i) => ({ product: `q${i}`, url })), { product: 'orfa', url: pkey('c') }]);
    const report = await run(w, { library });
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toContain('content_ref_not_validated');
  });

  it('mapa com registros que se contradizem: chave×SHA, referência×objeto, referência sem objeto, objetos duplicados', async () => {
    const a = await world(2);
    await a.map.update((d) => {
      const k = Object.keys(d.objects)[0]!;
      d.objects[k]!.sha256 = 'f'.repeat(64);
      for (const r of Object.values(d.refs)) if (r.key === k) r.sha256 = 'f'.repeat(64);
    });
    expect(codes(await run(a), 'error')).toContain('key_sha_mismatch');

    const b = await world(2);
    await b.map.update((d) => void (d.refs[b.refs[0]!]!.sha256 = 'e'.repeat(64)));
    expect(codes(await run(b), 'error')).toContain('ref_sha_mismatch');

    const c = await world(2);
    await c.map.update((d) => void (d.refs['media/fantasma.webp'] = { key: pkey('9'), sha256: '9'.repeat(64), recordedAt: 'x' }));
    expect(codes(await run(c), 'error')).toContain('ref_without_object');

    const dup = await world(2);
    await dup.map.update((d) => {
      const [k, o] = Object.entries(d.objects)[0]!;
      d.objects[k.replace(/\.webp$/, '.png')] = { ...o };
    });
    const report = await run(dup);
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toContain('duplicate_objects');
  });

  it('mapa ilegível → map_unreadable, inconsistente, e o arquivo NÃO é "consertado"', async () => {
    const w = await world(2);
    writeFileSync(w.map.file, '{ isto não é json');
    const before = readFileSync(w.map.file);
    const report = await run(w);
    expect(report.state).toBe('inconsistent');
    expect(codes(report, 'error')).toEqual(['map_unreadable']);
    expect(readFileSync(w.map.file).equals(before)).toBe(true);
  });
});

describe('media:verify NUNCA escreve', () => {
  it('em nenhum dos estados: R2 sem put/delete, mapa e pastas intactos, toda listagem com prefixo', async () => {
    const scenarios: (() => Promise<{ w: World; extra?: Partial<Parameters<typeof verifyMedia>[0]> }>)[] = [
      async () => ({ w: await world(3, 0) }),
      async () => ({ w: await world(3, 2) }),
      async () => ({ w: await world(3) }),
      async () => {
        const w = await world(3);
        w.remote.objects.delete(w.keys[0]!);
        await w.remote.put(pkey('e'), Buffer.from('x'), { contentType: 'image/webp' });
        return { w };
      },
      async () => {
        const w = await world(2);
        writeFileSync(w.map.file, 'lixo');
        return { w };
      },
    ];
    for (const make of scenarios) {
      const { w } = await make();
      const putsBefore = w.remote.calls.put;
      const deletesBefore = w.remote.calls.delete;
      const deletedBefore = w.remote.deleted.length;
      const objectsBefore = new Map(w.remote.objects);
      const mapBefore = existsSync(w.map.file) ? readFileSync(w.map.file) : null;
      const disk = snapshot(t.dataDir, t.work);

      await run(w);

      expect(w.remote.calls.put).toBe(putsBefore);
      expect(w.remote.calls.delete).toBe(deletesBefore);
      expect(w.remote.deleted.length).toBe(deletedBefore);
      expect([...w.remote.objects]).toEqual([...objectsBefore]);
      expect(existsSync(w.map.file) ? readFileSync(w.map.file) : null).toEqual(mapBefore);
      expect(snapshot(t.dataDir, t.work)).toEqual(disk);
      expect(w.remote.listed.every((p) => p === 'p/' || p === 'healthcheck/')).toBe(true);
    }
  });

  it('o tipo do R2 que o verify recebe nem tem put nem delete; e o código-fonte não tem nenhuma escrita', () => {
    const ro: ReadOnlyRemote = new FakeR2StorageProvider();
    // @ts-expect-error — o verify só lê: não existe put
    void ro.put;
    // @ts-expect-error — o verify só lê: não existe delete
    void ro.delete;
    const writes = /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|unlink|unlinkSync|rm|rmSync|rename|renameSync|copyFileSync)\(|\.(put|delete|update|insert|execute|upsert)\(/;
    for (const file of ['verify.ts', 'verify-cli.ts', 'collection.ts']) expect(readFileSync(`apps/server/src/media/${file}`, 'utf8'), file).not.toMatch(writes);
  });
});

describe('a migração e o dry-run não escrevem onde não devem', () => {
  it('dry-run: nenhum PUT, nenhum DELETE, nada no R2, nem mapa criado', async () => {
    const tag = ++counter;
    const refs = [t.writeMedia(`dr${tag}-0.webp`, await image()), t.writeMedia(`dr${tag}-1.webp`, await image())];
    const map = t.newMap();
    const remote = new FakeR2StorageProvider();
    const report = await dryRun(inventory(refs, resolveLocal), map.read(), remote);
    expect(report.keysToCreate).toHaveLength(2);
    expect(remote.calls).toMatchObject({ put: 0, delete: 0 });
    expect(remote.objects.size).toBe(0);
    expect(existsSync(map.file)).toBe(false);
  });

  it('migrateObjects não muda a biblioteca (banco): ela nem entra na função, e uma cópia congelada sai idêntica', async () => {
    const tag = ++counter;
    const refs = [t.writeMedia(`mg${tag}-0.webp`, await image()), t.writeMedia(`mg${tag}-1.webp`, await image())];
    const library = tinyLibrary(refs.map((url, i) => ({ product: `m${i}`, url })));
    const before = structuredClone(library);
    const freeze = (o: unknown): unknown => {
      if (o && typeof o === 'object') Object.values(o).forEach(freeze);
      return Object.freeze(o);
    };
    freeze(library);
    const items = inventory(refLocations(library).map((l) => l.ref), resolveLocal);
    const report = await migrateObjects(items, { remote: new FakeR2StorageProvider(), map: t.newMap() });
    expect(report.ok).toBe(true);
    expect(library).toEqual(before);
  });

  it('as CLIs de migração/verify não importam nada que grave no banco (virada, upsert, import, insert/update/delete)', () => {
    const forbidden = /applyRefChanges|planCutover|planRollback|importLibrary|upsert|\.(insert|update|delete|execute)\(/;
    for (const file of ['cli.ts', 'collection.ts', 'verify-cli.ts', 'smoke-cli.ts']) expect(readFileSync(`apps/server/src/media/${file}`, 'utf8'), file).not.toMatch(forbidden);
  });

  it('sha() e a chave do mapa concordam (sanidade do helper)', async () => {
    const body = await image();
    expect(sha(body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
