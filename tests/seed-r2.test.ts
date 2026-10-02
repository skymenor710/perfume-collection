import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Perfume } from '@perfumes/core/perfume';
import { resolveImageFile } from '../apps/server/src/db/checks';
import { seedRefs } from '../apps/server/src/media/content';
import { emptyMap, MediaMapError, type MediaMap } from '../apps/server/src/media/map';
import { inventory, migrateObjects } from '../apps/server/src/media/migrate';
import { seedUpgrades } from '../apps/server/src/repositories/rules';
import { isContentKey } from '../apps/server/src/storage/keys';
import { FakeR2StorageProvider } from './helpers/fake-r2';
import { image, mediaResolver, networkTrap, setupTempData, settingsFor } from './helpers/media-fixtures';
import { seedPerfumes } from './helpers/db';

/**
 * FASE 3.1 (hardening sem credenciais) — `seedUpgrades` com o R2, cenário a cenário.
 *
 * A REGRA: uma referência NUNCA vira chave do R2 sem existir uma entrada `validated` e coerente no mapa — e nenhuma
 * atualização acontece às escondidas (mapa ilegível = nada é atualizado). Idempotência: rodar de novo não muda nada.
 * Fotos de verdade (6×6 px) em pasta temporária; o R2 é um falso em memória; nada toca rede, Neon ou o .env.local.
 */

const t = setupTempData('seed');
const resolver = mediaResolver(t.dataDir);
let counter = 0;
let trap: ReturnType<typeof networkTrap>;
beforeEach(() => {
  trap = networkTrap();
});
afterEach(() => {
  expect(trap.offending).toEqual([]);
  trap.restore();
});

type Role = 'img' | 'thumb' | 'master';
const base = seedPerfumes()[0]!;
const apply = (current: Perfume, upgrades: Perfume[]) => upgrades.find((u) => u.id === current.id) ?? current;
const photoRefs = (p: Perfume) => [p.imageUrl, p.thumbUrl, p.masterUrl];

/** Um perfume da planilha (origem google-sheet) com 3 fotos reais em data/media, migradas para um R2 falso. */
async function world(migrate: Role[] = ['img', 'thumb', 'master']) {
  const tag = ++counter;
  const bodies = { img: await image(), thumb: await image(), master: await image('png') };
  const files = { img: t.writeMedia(`s${tag}-lg.webp`, bodies.img), thumb: t.writeMedia(`s${tag}-sm.webp`, bodies.thumb), master: t.writeMedia(`s${tag}.png`, bodies.master) };
  const map = t.newMap();
  const remote = new FakeR2StorageProvider();
  if (migrate.length) expect((await migrateObjects(inventory(migrate.map((r) => files[r]), resolver), { remote, map })).ok).toBe(true);
  const current: Perfume = { ...base, id: `sementa-${tag}`, origin: 'google-sheet', assetVersion: 1, imageUrl: files.img, thumbUrl: files.thumb, masterUrl: files.master };
  const newer: Perfume = { ...current, assetVersion: 2 };
  /** O mesmo perfume depois da virada: cada foto já é a chave do R2. */
  const cutover = (): Perfume => ({ ...current, imageUrl: map.validatedKeyFor(files.img), thumbUrl: map.validatedKeyFor(files.thumb), masterUrl: map.validatedKeyFor(files.master) });
  return { tag, bodies, files, map, remote, current, newer, cutover };
}

/** A regra: toda chave por conteúdo gravada tem entrada validada e coerente no mapa. */
function expectOnlyValidatedKeys(upgrades: Perfume[], map: MediaMap) {
  for (const p of upgrades) for (const ref of photoRefs(p)) if (ref && isContentKey(ref)) expect(map.isValidated(ref), `chave sem validação: ${ref}`).toBe(true);
}

/** Aplica e roda de novo várias vezes: a partir da 2ª execução, nada muda. */
function expectStable(current: Perfume, seed: Perfume, refs: ReturnType<typeof seedRefs>, runs = 3) {
  let now = current;
  const first = seedUpgrades([now], [seed], refs);
  now = apply(now, first);
  for (let i = 0; i < runs; i++) expect(seedUpgrades([now], [seed], refs), `execução ${i + 2}`).toEqual([]);
  return { first, final: now };
}

describe('seed local sem mapa', () => {
  it('atualiza uma vez com as referências locais; 2ª e 3ª não mudam nada; ler o mapa não cria o arquivo', async () => {
    const w = await world([]);
    expect(existsSync(w.map.file)).toBe(false);
    const refs = seedRefs(settingsFor('local', null, w.map));
    const { first, final } = expectStable(w.current, w.newer, refs);
    expect(first).toHaveLength(1);
    expect(photoRefs(first[0]!)).toEqual([w.files.img, w.files.thumb, w.files.master]);
    expect(final.assetVersion).toBe(2);
    expect(existsSync(w.map.file)).toBe(false);
  });
});

describe('seed local com mapa', () => {
  it('banco ainda local: grava as referências LOCAIS (nunca chaves), e fica estável', async () => {
    const w = await world();
    const { first } = expectStable(w.current, w.newer, seedRefs(settingsFor('local', w.remote, w.map)));
    expect(photoRefs(first[0]!)).toEqual([w.files.img, w.files.thumb, w.files.master]);
    expect(photoRefs(first[0]!).some((r) => r && isContentKey(r))).toBe(false);
  });

  it('banco já com as chaves e semente da MESMA versão: nada a fazer (a chave é a mesma foto)', async () => {
    const w = await world();
    const refs = seedRefs(settingsFor('local', w.remote, w.map));
    for (let i = 0; i < 3; i++) expect(seedUpgrades([w.cutover()], [w.current], refs)).toEqual([]);
  });
});

describe('seed R2 com mapa completo', () => {
  it('banco ainda local: grava as CHAVES validadas (uma vez), sem subir nada, e fica estável', async () => {
    const w = await world();
    const puts = w.remote.calls.put;
    const refs = seedRefs(settingsFor('r2', w.remote, w.map));
    const { first, final } = expectStable(w.current, w.newer, refs, 5);
    expect(first).toHaveLength(1);
    expect(photoRefs(first[0]!)).toEqual([w.map.validatedKeyFor(w.files.img), w.map.validatedKeyFor(w.files.thumb), w.map.validatedKeyFor(w.files.master)]);
    expectOnlyValidatedKeys(first, w.map);
    expect(photoRefs(final).every((r) => r && isContentKey(r))).toBe(true);
    expect(w.remote.calls.put).toBe(puts); // nenhum upload
    expect(w.remote.calls.delete).toBe(0);
  });

  it('banco já com as chaves: a semente nova grava as MESMAS chaves (nada volta para o arquivo local), e fica estável', async () => {
    const w = await world();
    const current = w.cutover();
    const { first } = expectStable(current, w.newer, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(photoRefs(first[0]!)).toEqual(photoRefs(current));
  });
});

describe('seed R2 com mapa incompleto', () => {
  it('só 2 das 3 fotos no mapa: as validadas viram chave, a terceira continua local — cada referência por si', async () => {
    const w = await world(['img', 'master']);
    const refs = seedRefs(settingsFor('r2', w.remote, w.map));
    const { first, final } = expectStable(w.current, w.newer, refs);
    expect(final.imageUrl).toBe(w.map.validatedKeyFor(w.files.img));
    expect(final.masterUrl).toBe(w.map.validatedKeyFor(w.files.master));
    expect(final.thumbUrl).toBe(w.files.thumb); // sem objeto validado: nada de chave
    expectOnlyValidatedKeys(first, w.map);
  });

  it('mapa que existe mas está vazio: tudo continua local', async () => {
    const w = await world([]);
    await w.map.update(() => {});
    const { first } = expectStable(w.current, w.newer, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(photoRefs(first[0]!)).toEqual([w.files.img, w.files.thumb, w.files.master]);
  });

  it('semente real (bottles/…, as fotos de verdade só LIDAS): migrar só 5 e atualizar todos → só as migradas viram chave', async () => {
    const seed = seedPerfumes();
    const refsOf = (p: Perfume) => photoRefs(p).filter((r): r is string => Boolean(r));
    const migratedIds = new Set(seed.slice(0, 5).map((p) => p.id));
    const map = t.newMap();
    const remote = new FakeR2StorageProvider();
    const report = await migrateObjects(inventory(seed.filter((p) => migratedIds.has(p.id)).flatMap(refsOf), resolveImageFile), { remote, map });
    expect(report.ok).toBe(true);
    const current = seed.map((p) => ({ ...p, assetVersion: p.assetVersion - 1 }));
    const refs = seedRefs(settingsFor('r2', remote, map));
    const first = seedUpgrades(current, seed, refs);
    expect(first).toHaveLength(seed.length);
    expectOnlyValidatedKeys(first, map);
    for (const p of first) {
      const isKey = refsOf(p).map((r) => isContentKey(r)); // só as referências que existem (masterUrl pode ser nulo)
      expect(isKey.every(Boolean) || isKey.every((k) => !k), p.id).toBe(true); // migrada inteira ou nada
      expect(isKey[0]).toBe(migratedIds.has(p.id));
    }
    const after = current.map((p) => apply(p, first));
    for (let i = 0; i < 3; i++) expect(seedUpgrades(after, seed, refs)).toEqual([]);
  });
});

describe('mapa inválido: nada é atualizado às escondidas', () => {
  it.each([
    ['texto que não é JSON', 'isto não é json'],
    ['JSON de outra forma', JSON.stringify({ version: 2, coisa: true })],
    ['JSON com objeto sem campos', JSON.stringify({ ...emptyMap(), objects: { [`p/${'a'.repeat(64)}.webp`]: {} } })],
  ])('%s → seedRefs lança o erro do mapa (o que o servidor trata como "não atualiza") e o arquivo fica como estava', async (_label, content) => {
    const w = await world();
    writeFileSync(w.map.file, content);
    const before = readFileSync(w.map.file);
    for (const backend of ['local', 'r2'] as const) {
      expect(() => seedRefs(settingsFor(backend, w.remote, w.map))).toThrow(MediaMapError);
      expect(() => seedRefs(settingsFor(backend, w.remote, w.map))).toThrow(/Mapa de migração/);
    }
    expect(readFileSync(w.map.file).equals(before)).toBe(true);
  });

  it('o servidor só engole o erro do MAPA (o texto que upgradeFromSeed e repositories/index reconhecem)', () => {
    const storeSource = readFileSync('apps/server/src/store.ts', 'utf8');
    expect(storeSource).toContain('Mapa de migração');
    expect(storeSource).toMatch(/library\.upgraded', \{ skipped: error\.message \}, 'warn'/);
  });
});

describe('referências já convertidas, inexistentes e nulas', () => {
  it('referência inexistente (sem arquivo, fora do mapa) fica como está; nula continua nula', async () => {
    const w = await world();
    const ghost = 'media/foto-que-nunca-existiu.webp';
    const current: Perfume = { ...w.current, imageUrl: ghost, thumbUrl: null, masterUrl: null };
    const seed: Perfume = { ...current, assetVersion: 2 };
    const { first } = expectStable(current, seed, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(photoRefs(first[0]!)).toEqual([ghost, null, null]);
  });

  it('foto trocada pela pessoa (referência que não é da semente) não é tocada quando a versão é a mesma', async () => {
    const w = await world();
    const personal = 'media/foto-da-pessoa.webp';
    const current: Perfume = { ...w.current, imageUrl: personal };
    expect(seedUpgrades([current], [{ ...w.current, assetVersion: 1 }], seedRefs(settingsFor('r2', w.remote, w.map)))).toEqual([]);
  });
});

describe('SHA divergente: a foto do arquivo não é a que foi provada no R2', () => {
  it('arquivo local trocado (mesmo nome, outra foto) depois da migração → NÃO herda a chave antiga; o resto migra normalmente', async () => {
    const w = await world();
    const file = resolver(w.files.img)!;
    const stamp = statSync(file).mtimeMs;
    writeFileSync(file, await image('webp', [200, 10, 10]));
    utimesSync(file, new Date(), new Date(stamp + 60_000)); // mtime distinto (o cache de SHA é por caminho+data+tamanho)
    const refs = seedRefs(settingsFor('r2', w.remote, w.map));
    const { first, final } = expectStable(w.current, w.newer, refs);
    expect(final.imageUrl).toBe(w.files.img); // continua local: a chave antiga é de OUTRA foto
    expect(final.thumbUrl).toBe(w.map.validatedKeyFor(w.files.thumb));
    expect(final.masterUrl).toBe(w.map.validatedKeyFor(w.files.master));
    expectOnlyValidatedKeys(first, w.map);
  });

  it('arquivo local restaurado (mesmos bytes) → volta a converter', async () => {
    const w = await world();
    const file = resolver(w.files.img)!;
    writeFileSync(file, await image('webp', [200, 10, 10]));
    utimesSync(file, new Date(), new Date(Date.now() + 60_000));
    expect(seedUpgrades([w.current], [w.newer], seedRefs(settingsFor('r2', w.remote, w.map)))[0]!.imageUrl).toBe(w.files.img);
    writeFileSync(file, w.bodies.img);
    utimesSync(file, new Date(), new Date(Date.now() + 120_000));
    expect(seedUpgrades([w.current], [w.newer], seedRefs(settingsFor('r2', w.remote, w.map)))[0]!.imageUrl).toBe(w.map.validatedKeyFor(w.files.img));
  });

  it('arquivo local ausente não desmente o mapa (a semente chega pelo site; o que vale é o que foi provado)', async () => {
    const w = await world();
    const gone = { ...w.current, imageUrl: 'media/sumiu-depois.webp' };
    await w.map.update((d) => {
      const k = w.map.validatedKeyFor(w.files.img)!;
      d.refs['media/sumiu-depois.webp'] = { key: k, sha256: d.objects[k]!.sha256, recordedAt: 'x' };
    });
    const out = seedUpgrades([gone], [{ ...gone, assetVersion: 2 }], seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(out[0]!.imageUrl).toBe(w.map.validatedKeyFor(w.files.img));
  });

  it('o mapa guarda, para a referência, um SHA diferente do do objeto → não vale', async () => {
    const w = await world();
    await w.map.update((d) => void (d.refs[w.files.img]!.sha256 = 'e'.repeat(64)));
    const { final } = expectStable(w.current, w.newer, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(final.imageUrl).toBe(w.files.img);
    expect(final.thumbUrl).toBe(w.map.validatedKeyFor(w.files.thumb));
  });
});

describe('chave divergente: o que a chave promete não é o que o mapa registrou', () => {
  it('o SHA-256 do objeto ≠ o SHA embutido na chave → a chave NÃO é validada', async () => {
    const w = await world();
    const key = w.map.validatedKeyFor(w.files.img)!;
    await w.map.update((d) => {
      d.objects[key]!.sha256 = 'f'.repeat(64);
      d.refs[w.files.img]!.sha256 = 'f'.repeat(64);
    });
    expect(w.map.isValidated(key)).toBe(false);
    expect(w.map.validatedKeyFor(w.files.img)).toBeNull();
    const { final } = expectStable(w.current, w.newer, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(final.imageUrl).toBe(w.files.img);
    expect(final.thumbUrl).toBe(w.map.validatedKeyFor(w.files.thumb));
  });

  it('a referência aponta para uma chave que nem existe no mapa → continua local', async () => {
    const w = await world();
    await w.map.update((d) => void (d.refs[w.files.img] = { key: `p/${'9'.repeat(64)}.webp`, sha256: '9'.repeat(64), recordedAt: 'x' }));
    const { final } = expectStable(w.current, w.newer, seedRefs(settingsFor('r2', w.remote, w.map)));
    expect(final.imageUrl).toBe(w.files.img);
  });

  it('o objeto não está "validated"? O schema nem deixa gravar outro status; e a virada (planCutover) usa a mesma regra estrita', async () => {
    const w = await world();
    const { planCutover } = await import('../apps/server/src/media/migrate');
    const { tinyLibrary } = await import('./helpers/media-fixtures');
    const key = w.map.validatedKeyFor(w.files.img)!;
    const lib = tinyLibrary([{ product: 'a', url: w.files.img }]);
    expect(planCutover(lib, w.map.read()).ok).toBe(true);
    await w.map.update((d) => void (d.objects[key]!.sha256 = 'f'.repeat(64)));
    const plan = planCutover(lib, w.map.read());
    expect(plan.ok).toBe(false);
    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
  });
});
