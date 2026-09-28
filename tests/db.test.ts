import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Library } from '@perfumes/core/library';
import { REFLECTION_EXPECTED, reflectionChecks } from '../apps/server/src/db/checks';
import { redactDbError, type DbHandle } from '../apps/server/src/db/client';
import { diffLibraries } from '../apps/server/src/db/compare';
import { importLibrary, validateLibrary } from '../apps/server/src/db/importer';
import { entries, productImages, products, productVariants, users } from '../apps/server/src/db/schema';
import { loadLibrary, sortedLibrary } from '../apps/server/src/db/snapshot';
import { migrationStatus } from '../apps/server/src/db/status';
import { applyMigrations } from '../apps/server/src/db/client';
import { EntryOwnershipError, OwnerNotFoundError, PostgresLibraryRepository } from '../apps/server/src/repositories/postgres';
import { libraryViews } from '../apps/server/src/repositories/rules';
import { fixtureLibrary, freshDb, imageFolder, OWNER, serverTarget, usingServer } from './helpers/db';

/** Erro do Postgres por código (23505 único, 23503 chave estrangeira, 23514 check), atravessando o embrulho do drizzle. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? 'sem-código';
  }
  return 'não falhou';
}

let handle: DbHandle;
let lib: Library;
beforeEach(async () => {
  handle = await freshDb();
  lib = fixtureLibrary();
});
afterEach(async () => {
  await handle.close();
});

/** Contagens esperadas, tiradas da própria fixture (semente + casos especiais). */
const expected = (l: Library) => ({
  users: l.users.length,
  products: l.products.length,
  variants: l.products.reduce((n, p) => n + p.variants.length, 0),
  images: l.products.reduce((n, p) => n + p.images.length, 0),
  entries: l.entries.length,
});
const allCounts = async () => [await count(users), await count(products), await count(productVariants), await count(productImages), await count(entries)];
const validate = (l: Library = lib) => validateLibrary(JSON.parse(JSON.stringify(l)), imageFolder(l));
const count = async (table: typeof users | typeof products | typeof productVariants | typeof productImages | typeof entries) =>
  Number((await handle.db.select({ n: sql<number>`count(*)` }).from(table))[0]!.n);

describe(`schema e migrations (${usingServer ? 'servidor Postgres' : 'PGlite'})`, () => {
  it('a migration versionada cria tudo do zero e está em dia', async () => {
    const status = await migrationStatus(handle.db);
    expect(status.upToDate).toBe(true);
    expect(status.expected[0]).toBe('0000_inicial');
    // Aplicar de novo não faz nada (mesmos arquivos, mesmo journal).
    await applyMigrations(handle);
    expect((await migrationStatus(handle.db)).applied).toBe(status.applied);
  });

  it('tabelas, chaves estrangeiras compostas e únicos existem', async () => {
    const res = (await handle.db.execute(sql`select conname from pg_constraint where connamespace = 'public'::regnamespace`)) as unknown as { rows: { conname: string }[] };
    const names = res.rows.map((r) => r.conname);
    for (const c of ['entries_variant_fk', 'product_images_variant_fk', 'entries_user_id_users_id_fk', 'product_variants_product_id_id_pk', 'entries_price_nonnegative', 'users_username_format']) expect(names).toContain(c);
  });
});

describe('constraints protegem o banco mesmo se a aplicação errar', () => {
  beforeEach(async () => {
    const report = await importLibrary(handle.db, validate());
    expect(report.ok).toBe(true);
  });

  it('a mesma pessoa não tem o mesmo perfume duas vezes na mesma lista', async () => {
    const [e] = await handle.db.select().from(entries).limit(1);
    expect(await pgError(handle.db.insert(entries).values({ ...e!, id: 'outra-entrada' }))).toBe('23505');
  });

  it('a versão escolhida precisa ser do MESMO produto', async () => {
    const [e] = await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste'));
    expect(await pgError(handle.db.update(entries).set({ variantId: 'e50' }).where(eq(entries.id, e!.id)))).toBe('23503');
  });

  it('versão duplicada no produto e imagem duplicada no produto são recusadas', async () => {
    const [v] = await handle.db.select().from(productVariants).limit(1);
    expect(await pgError(handle.db.insert(productVariants).values(v!))).toBe('23505');
    const [i] = await handle.db.select().from(productImages).limit(1);
    const { id: _id, ...image } = i!;
    expect(await pgError(handle.db.insert(productImages).values(image))).toBe('23505');
  });

  it('preço negativo, moeda fora do padrão e username fora do formato são recusados', async () => {
    expect(await pgError(handle.db.update(entries).set({ price: '-1.00' }).where(eq(entries.id, 'empire-teste')))).toBe('23514');
    expect(await pgError(handle.db.update(entries).set({ currency: 'eur' }).where(eq(entries.id, 'empire-teste')))).toBe('23514');
    expect(await pgError(handle.db.update(users).set({ username: 'Com Espaço' }).where(eq(users.id, OWNER.id)))).toBe('23514');
  });

  it('username é único sem diferenciar maiúsculas', async () => {
    expect(await pgError(handle.db.insert(users).values({ id: 'u2', username: 'dono', displayName: 'Outro' }))).toBe('23505');
  });

  it('dinheiro é decimal exato (numeric), não ponto flutuante', async () => {
    const [e] = await handle.db.select({ price: entries.price }).from(entries).where(eq(entries.id, 'mykonos-reflection-teste'));
    expect(e!.price).toBe('35.95');
    const [v] = await handle.db.select({ price: productVariants.price }).from(productVariants).where(eq(productVariants.id, 'e100'));
    expect(v!.price).toBe('859000.00');
    // Em ponto flutuante 0.1 + 0.2 = 0.30000000000000004; em numeric é exatamente 0.30.
    const sum = (await handle.db.execute(sql`select (0.1::numeric(12,2) + 0.2::numeric(12,2))::text as s`)) as unknown as { rows: { s: string }[] };
    expect(sum.rows[0]!.s).toBe('0.30');
  });

  it('volume estruturado: número quando é um volume só, texto sempre preservado', async () => {
    const [r] = await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste'));
    expect([r!.volumeText, Number(r!.volumeMl)]).toEqual(['50 ml', 50]);
    const [emp] = await handle.db.select().from(entries).where(eq(entries.id, 'empire-teste'));
    expect([emp!.volumeText, emp!.volumeMl]).toEqual(['50/100 ml', null]);
    const vs = await handle.db.select().from(productVariants).where(eq(productVariants.productId, 'empire-teste'));
    expect(vs.map((v) => Number(v.volumeMl)).sort((a, b) => a - b)).toEqual([50, 100]);
  });
});

describe('validação antes de tocar no banco', () => {
  it('biblioteca íntegra passa, com aviso para "50/100 ml"', () => {
    const v = validate();
    expect(v.problems).toEqual([]);
    expect(v.warnings.join()).toMatch(/50\/100 ml/);
    expect(v.images.every((i) => i.exists && i.sha256?.length === 64)).toBe(true);
  });

  it.each<[string, (l: Library) => void, RegExp]>([
    ['arquivo de imagem faltando', (l) => (l.products[0]!.images[0]!.url = 'media/nao-existe.webp'), /arquivo não encontrado/],
    ['versão escolhida de outro produto', (l) => (l.entries.find((e) => e.id === 'mykonos-reflection-teste')!.variantId = 'e50'), /não é do produto/],
    ['preço com 3 casas', (l) => (l.entries[0]!.price = 35.955), /mais de 2 casas|seria alterado/],
    ['moeda inválida', (l) => (l.entries[0]!.currency = 'euro'), /moeda|seria alterado/],
    ['entrada duplicada', (l) => l.entries.push({ ...l.entries[0]! }), /duplicad/],
    ['entrada apontando para produto inexistente', (l) => (l.entries[0]!.productId = 'nao-existe'), /descartad|não existe/],
  ])('recusa: %s', (_label, mutate, problem) => {
    const broken = JSON.parse(JSON.stringify(lib)) as Library;
    mutate(broken);
    const v = validateLibrary(broken, imageFolder(lib));
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toMatch(problem);
  });

  it('validação falhou = banco intocado', async () => {
    const broken = JSON.parse(JSON.stringify(lib)) as Library;
    broken.entries[0]!.price = 1.234;
    const report = await importLibrary(handle.db, validateLibrary(broken, imageFolder(lib)));
    expect(report.ok).toBe(false);
    expect(report.stage).toBe('validação');
    expect(await count(entries)).toBe(0);
  });
});

describe('importação: atômica, verificada, idempotente', () => {
  it('importa tudo e o banco relido é IGUAL ao JSON, campo a campo', async () => {
    const report = await importLibrary(handle.db, validate());
    expect(report.ok).toBe(true);
    const want = expected(lib);
    expect(report.tables.entries).toMatchObject({ source: want.entries, inserted: want.entries });
    expect(report.tables.variants.inserted).toBe(want.variants);
    expect(await allCounts()).toEqual(Object.values(want));
    expect(report.verification).toEqual([]);
    expect(diffLibraries(sortedLibrary(lib), await loadLibrary(handle.db))).toEqual([]);
  });

  it('segunda execução: nenhuma alteração necessária, nada duplicado', async () => {
    await importLibrary(handle.db, validate());
    const again = await importLibrary(handle.db, validate());
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
    expect(again.message).toMatch(/Nenhuma alteração necessária/);
    for (const t of Object.values(again.tables)) expect(t.inserted + t.updated).toBe(0);
    expect(await allCounts()).toEqual(Object.values(expected(lib)));
  });

  it.each(['users', 'products', 'variants', 'images', 'entries'] as const)('falha na etapa %s = ROLLBACK total', async (failAt) => {
    await expect(importLibrary(handle.db, validate(), { failAt })).rejects.toThrow(/ROLLBACK/);
    expect([await count(users), await count(products), await count(productVariants), await count(productImages), await count(entries)]).toEqual([0, 0, 0, 0, 0]);
  });

  it('verificação que não bate = ROLLBACK (nada gravado)', async () => {
    const report = await importLibrary(handle.db, validate(), { failAt: 'verification' });
    expect(report.ok).toBe(false);
    expect(report.stage).toBe('verificação');
    expect(await count(entries)).toBe(0);
  });

  it('checagem extra que falha (ex.: Reflection virou 100 ml) = ROLLBACK', async () => {
    const report = await importLibrary(handle.db, validate(), { checks: () => ['Mykonos Reflection: aparece como 100 ml — PARAR'] });
    expect(report.ok).toBe(false);
    expect(report.stage).toBe('checagens');
    expect(await count(products)).toBe(0);
  });

  it('ensaio (dry-run) faz tudo e não grava nada', async () => {
    const report = await importLibrary(handle.db, validate(), { dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.tables.entries.inserted).toBe(lib.entries.length);
    expect(await count(entries)).toBe(0);
  });

  it('banco diferente do JSON: PARA e mostra campo, valor antigo e novo; só atualiza com permissão', async () => {
    await importLibrary(handle.db, validate());
    await handle.db.update(entries).set({ price: '40.00' }).where(eq(entries.id, 'mykonos-reflection-teste'));
    const stopped = await importLibrary(handle.db, validate());
    expect(stopped.ok).toBe(false);
    expect(stopped.stage).toBe('conflito');
    expect(stopped.conflicts).toContainEqual({ path: 'entries[mykonos-reflection-teste].price', left: 40, right: 35.95 });
    expect((await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste')))[0]!.price).toBe('40.00');
    const updated = await importLibrary(handle.db, validate(), { allowUpdate: true });
    expect(updated.ok).toBe(true);
    expect(updated.tables.entries.updated).toBe(1);
    expect((await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste')))[0]!.price).toBe('35.95');
  });

  it('registro que só existe no banco nunca é apagado', async () => {
    await importLibrary(handle.db, validate());
    const repo = await PostgresLibraryRepository.open(handle.db);
    const extra = { ...(await repo.list())[0]!, id: 'so-no-banco', name: 'Só no banco' };
    await repo.upsert(extra);
    const again = await importLibrary(handle.db, validate());
    expect(again.tables.entries.onlyInDb).toBe(1);
    expect((await repo.list()).some((p) => p.id === 'so-no-banco')).toBe(true);
  });

  it('duas importações ao mesmo tempo: uma trava a outra, nada duplica', async () => {
    const [a, b] = await Promise.all([importLibrary(handle.db, validate()), importLibrary(handle.db, validate())]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1);
    expect(await count(entries)).toBe(lib.entries.length);
  });

  it('Mykonos Reflection continua 50 ml: versão, imagem ligada à versão, preço e lista', async () => {
    await importLibrary(handle.db, validate());
    const db = await loadLibrary(handle.db);
    const e = db.entries.find((x) => x.id === 'mykonos-reflection-teste')!;
    const p = db.products.find((x) => x.id === e.productId)!;
    expect(e.volume).toBe('50 ml');
    expect(e.variantId).toBe('58518844047705');
    expect(p.variants.find((v) => v.id === e.variantId)?.volume).toBe('50 ml');
    expect(p.images[0]).toMatchObject({ url: 'media/reflection-50-lg.webp', variantId: '58518844047705' });
    expect([e.price, e.currency, e.list]).toEqual([35.95, 'EUR', 'wishlist']);
    expect(e.volume).not.toMatch(/100/);
  });

  it('referências de imagem continuam as de hoje (bottles/…, media/…) e o SHA-256 fica registrado', async () => {
    await importLibrary(handle.db, validate());
    const imgs = await handle.db.select().from(productImages);
    expect(imgs.every((i) => /^(bottles|media)\//.test(i.ref) && i.sha256?.length === 64)).toBe(true);
  });

  it('ERRO REAL do Postgres no meio (etapa das entradas, com banco já populado): ROLLBACK, estado anterior intacto', async () => {
    // Estado anterior: a biblioteca já importada.
    expect((await importLibrary(handle.db, validate())).ok).toBe(true);
    const before = await loadLibrary(handle.db);
    const countsBefore = await allCounts();
    // Uma biblioteca maior: tudo o que já existe + um perfume novo (usuário, produto, versões, imagem e entrada novos).
    const bigger = JSON.parse(JSON.stringify(lib)) as Library;
    const novo = JSON.parse(JSON.stringify(bigger.products.find((p) => p.id === 'mykonos-reflection-teste'))) as Library['products'][number];
    novo.id = 'perfume-novo';
    novo.name = 'Perfume Novo';
    novo.images = novo.images.map((i) => ({ ...i, url: 'media/perfume-novo-lg.webp', thumbUrl: 'media/perfume-novo-sm.webp', masterUrl: 'media/perfume-novo.png' }));
    bigger.products.push(novo);
    bigger.users.push({ ...OWNER, id: 'u_novo', username: 'novo_usuario' });
    const entry = bigger.entries.find((e) => e.id === 'mykonos-reflection-teste')!;
    bigger.entries.push({ ...entry, id: 'perfume-novo', productId: 'perfume-novo', userId: 'u_novo' });
    // O Postgres (não o código) recusa a entrada nova DEPOIS de usuário, produto, versões e imagens já inseridos.
    await handle.db.execute(sql.raw(`create or replace function falha_teste() returns trigger language plpgsql as $$ begin raise exception 'falha real do banco na entrada %', new.id; end $$`));
    await handle.db.execute(sql.raw(`create trigger falha_teste before insert on entries for each row when (new.id = 'perfume-novo') execute function falha_teste()`));
    await expect(importLibrary(handle.db, validate(bigger))).rejects.toThrow(/ROLLBACK/);
    // Nada do que entrou antes da falha ficou: nem o usuário, nem o produto, nem as versões, nem a imagem.
    expect(await allCounts()).toEqual(countsBefore);
    expect(diffLibraries(before, await loadLibrary(handle.db))).toEqual([]);
    expect(await handle.db.select().from(users).where(eq(users.id, 'u_novo'))).toEqual([]);
    expect(await handle.db.select().from(products).where(eq(products.id, 'perfume-novo'))).toEqual([]);
    // Sem o gatilho, a mesma importação passa inteira — nada "meio gravado" ficou no caminho.
    await handle.db.execute(sql.raw('drop trigger falha_teste on entries'));
    const ok = await importLibrary(handle.db, validate(bigger));
    expect(ok.ok).toBe(true);
    expect(ok.tables.entries.inserted).toBe(1);
  });
});

describe('transação: falha deliberada desfaz tudo', () => {
  beforeEach(async () => {
    await importLibrary(handle.db, validate());
  });

  it('estado inicial → 1ª alteração → 2ª alteração → erro → ROLLBACK → estado final idêntico ao inicial', async () => {
    const initial = await loadLibrary(handle.db);
    const countsInitial = await allCounts();
    const seen: string[] = [];
    await expect(
      handle.db.transaction(async (tx) => {
        // 1ª alteração: preço de uma entrada.
        await tx.update(entries).set({ price: '1.00' }).where(eq(entries.id, 'mykonos-reflection-teste'));
        seen.push(String((await tx.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste')))[0]!.price));
        // 2ª alteração: uma versão nova no produto.
        await tx.insert(productVariants).values({ productId: 'mykonos-reflection-teste', id: 'v-tmp', position: 9, label: '200 ml', volumeText: '200 ml', volumeMl: '200' });
        seen.push(String((await tx.select().from(productVariants).where(eq(productVariants.id, 'v-tmp'))).length));
        // Erro deliberado.
        throw new Error('erro deliberado');
      }),
    ).rejects.toThrow('erro deliberado');
    // Dentro da transação as duas alterações existiam…
    expect(seen).toEqual(['1.00', '1']);
    // …e depois do ROLLBACK nenhuma permanece.
    expect(await allCounts()).toEqual(countsInitial);
    expect(diffLibraries(initial, await loadLibrary(handle.db))).toEqual([]);
    expect((await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste')))[0]!.price).toBe('35.95');
  });

  it('o repositório também: gravação que falha no banco não deixa nada pela metade', async () => {
    const repo = await PostgresLibraryRepository.open(handle.db);
    const initial = await loadLibrary(handle.db);
    const r = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    // Nome novo + preço novo + versão que viola o CHECK de preço (o banco recusa no meio da gravação).
    const bad = { ...r, name: 'Não pode ficar', price: 1, variants: r.variants.map((v, i) => (i === 1 ? { ...v, price: -5 } : v)) };
    expect(await pgError(repo.upsert(bad))).toBe('23514');
    expect(diffLibraries(initial, await loadLibrary(handle.db))).toEqual([]);
  });
});

describe('Mykonos Reflection: checagem com valores fixos (variant ID incluído)', () => {
  // A semente de teste também traz um Reflection ('mykonos-reflection'); a coleção real tem exatamente um.
  // Aqui fica só o caso especial, para a checagem "exatamente 1 registro" valer como na coleção real.
  const one = (): Library => {
    const l = JSON.parse(JSON.stringify(lib)) as Library;
    return { ...l, products: l.products.filter((p) => p.id !== 'mykonos-reflection'), entries: l.entries.filter((e) => e.productId !== 'mykonos-reflection') };
  };
  const reflectionOf = (l: Library) => l.entries.find((e) => e.id === 'mykonos-reflection-teste')!;

  it('a biblioteca certa passa em todas as checagens, inclusive id da entrada/produto e foto', () => {
    expect(REFLECTION_EXPECTED.variantId).toBe('58518844047705');
    expect(reflectionChecks(one(), { entryId: 'mykonos-reflection-teste', imageRef: 'media/reflection-50-lg.webp' })).toEqual([]);
    // Dois registros (como na fixture inteira) também é recusado: a coleção real tem exatamente um.
    expect(reflectionChecks(lib).join()).toMatch(/esperado 1 registro, encontrado 2/);
  });

  it.each<[string, (l: Library) => void, RegExp]>([
    ['versão trocada para a de 100 ml', (l) => Object.assign(reflectionOf(l), { variantId: '58518844080473' }), /variant ID|100 ml/],
    ['volume 100 ml com a versão certa', (l) => Object.assign(reflectionOf(l), { volume: '100 ml' }), /volume da entrada|100 ml/],
    ['preço 35,90', (l) => Object.assign(reflectionOf(l), { price: 35.9 }), /preço/],
    ['moeda USD', (l) => Object.assign(reflectionOf(l), { currency: 'USD' }), /moeda/],
    ['foi para a coleção', (l) => Object.assign(reflectionOf(l), { list: 'collection' }), /lista/],
    ['foto desligada da versão', (l) => (l.products.find((p) => p.id === 'mykonos-reflection-teste')!.images[0]!.variantId = null), /imagem ligada/],
  ])('recusa: %s', (_label, mutate, problem) => {
    const broken = one();
    mutate(broken);
    const problems = reflectionChecks(broken, { entryId: 'mykonos-reflection-teste' });
    expect(problems.join('\n')).toMatch(problem);
    // Mostra esperado e encontrado (nunca corrige).
    expect(problems.join('\n')).toMatch(/esperado .* encontrado|PARAR/);
  });

  it('id de entrada/produto diferente do registrado é recusado', () => {
    expect(reflectionChecks(one(), { entryId: 'outro-id' }).join('\n')).toMatch(/id da entrada/);
  });
});

describe('PostgresLibraryRepository', () => {
  let repo: PostgresLibraryRepository;
  beforeEach(async () => {
    await importLibrary(handle.db, validate());
    repo = await PostgresLibraryRepository.open(handle.db);
  });

  it('entrega as MESMAS visões que o JSON entregaria, byte a byte', async () => {
    const pg = await repo.list();
    expect(JSON.stringify(pg)).toBe(JSON.stringify(libraryViews(lib, OWNER.id)));
  });

  it('gravar, editar, mover para a coleção e remover', async () => {
    const before = await repo.revision();
    const [first] = await repo.list();
    const edited = await repo.upsert({ ...first!, name: 'Nome novo', personalRating: 'rebuy', status: 'owned', price: 12.5, currency: 'EUR' });
    expect(edited).toMatchObject({ id: first!.id, name: 'Nome novo', personalRating: 'rebuy', status: 'owned', price: 12.5 });
    expect((await repo.list()).find((p) => p.id === first!.id)?.status).toBe('owned');
    expect(await repo.remove(first!.id)).toBe(true);
    expect(await repo.remove(first!.id)).toBe(false);
    expect((await handle.db.select().from(products).where(eq(products.id, first!.id))).length).toBe(0);
    expect(await repo.revision()).toBe(before + 2);
  });

  it('trocar de versão (50 → 100 ml) mantém a chave estrangeira válida o tempo todo', async () => {
    const r = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const to100 = await repo.upsert({ ...r, selectedVariantId: '58518844080473', volume: '100 ml', price: 49.95 });
    expect([to100.selectedVariantId, to100.volume, to100.price]).toEqual(['58518844080473', '100 ml', 49.95]);
    const back = await repo.upsert({ ...to100, selectedVariantId: '58518844047705', volume: '50 ml', price: 35.95 });
    expect(back.volume).toBe('50 ml');
  });

  it('versões removidas do produto somem; imagem trocada substitui a antiga', async () => {
    const e = (await repo.list()).find((p) => p.id === 'empire-teste')!;
    await repo.upsert({ ...e, variants: e.variants.slice(0, 1), imageUrl: 'media/empire-novo-lg.webp' });
    expect((await handle.db.select().from(productVariants).where(eq(productVariants.productId, 'empire-teste'))).map((v) => v.id)).toEqual(['e50']);
    expect((await handle.db.select().from(productImages).where(eq(productImages.productId, 'empire-teste'))).map((i) => i.ref)).toEqual(['media/empire-novo-lg.webp']);
  });

  it('perfil: validação igual à do JSON, nome em uso recusado', async () => {
    await handle.db.insert(users).values({ id: 'u_outra', username: 'outra', displayName: 'Outra' });
    await expect(repo.updateMe({ username: 'outra' })).rejects.toThrow('Esse nome já está em uso.');
    await expect(repo.updateMe({ username: 'admin' })).rejects.toThrow();
    expect((await repo.updateMe({ displayName: 'Novo nome', privacy: { wishlist: 'public' } })).displayName).toBe('Novo nome');
  });

  it('páginas públicas: privado = nulo; lista aberta sem campos pessoais; mídia pública só da lista aberta', async () => {
    expect(await repo.publicProfile('dono')).toBeNull();
    const img = (await repo.list()).find((p) => p.status === 'wishlist')!.imageUrl!;
    expect(await repo.isPublicMedia(img)).toBe(false);
    await repo.updateMe({ privacy: { wishlist: 'public' } });
    expect((await repo.publicProfile('DONO'))?.lists).toEqual(['wishlist']);
    const pub = (await repo.publicList('dono', 'wishlist'))!;
    expect(pub.length).toBeGreaterThan(0);
    expect(pub.every((p) => p.priceNote === null && Object.keys(p.fieldSources).length === 0)).toBe(true);
    expect(await repo.publicList('dono', 'collection')).toBeNull();
    expect(await repo.isPublicMedia(img)).toBe(true);
  });

  it('dado de outra pessoa nunca é sobrescrito', async () => {
    await handle.db.insert(users).values({ id: 'u_outra', username: 'outra', displayName: 'Outra' });
    const [e] = await handle.db.select().from(entries).limit(1);
    await handle.db.update(entries).set({ userId: 'u_outra' }).where(eq(entries.id, e!.id));
    const view = { ...(await repo.list())[0]!, id: e!.id };
    await expect(repo.upsert(view)).rejects.toBeInstanceOf(EntryOwnershipError);
    expect((await repo.list()).some((p) => p.id === e!.id)).toBe(false);
    expect(await repo.remove(e!.id)).toBe(false);
  });

  it('avisa a revisão nova a quem acompanha (SSE)', async () => {
    const seen: number[] = [];
    const off = repo.subscribe((r) => seen.push(r));
    const [first] = await repo.list();
    await repo.upsert({ ...first!, name: 'x' });
    off();
    await repo.upsert({ ...first!, name: 'y' });
    expect(seen).toHaveLength(1);
  });

  it('referências em uso incluem as três de cada imagem', async () => {
    const refs = await repo.referenced();
    expect(refs.has('media/reflection-50-lg.webp') && refs.has('media/reflection-50-sm.webp') && refs.has('media/reflection-50.png')).toBe(true);
  });

  it('entrada com texto hostil é guardada literalmente (consultas parametrizadas)', async () => {
    const [first] = await repo.list();
    const hostile = `Robert'); DROP TABLE entries;--`;
    await repo.upsert({ ...first!, name: hostile });
    expect((await repo.list()).find((p) => p.id === first!.id)?.name).toBe(hostile);
    expect(await count(entries)).toBe(lib.entries.length);
    expect(await repo.publicProfile(`x' OR '1'='1`)).toBeNull();
  });
});

describe('concorrência básica', () => {
  let repo: PostgresLibraryRepository;
  beforeEach(async () => {
    await importLibrary(handle.db, validate());
    repo = await PostgresLibraryRepository.open(handle.db);
  });

  it('20 gravações simultâneas de perfumes diferentes: todas entram, revisão +20, nada duplica', async () => {
    const base = (await repo.list())[0]!;
    const before = await repo.revision();
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.upsert({ ...base, id: `novo-${i}`, name: `Novo ${i}`, order: 1000 + i })));
    expect(await count(entries)).toBe(lib.entries.length + 20);
    expect(await repo.revision()).toBe(before + 20);
  });

  it('10 gravações simultâneas do MESMO perfume: uma entrada só, valor final é uma das gravações', async () => {
    const base = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const prices = Array.from({ length: 10 }, (_, i) => 30 + i);
    await Promise.all(prices.map((price) => repo.upsert({ ...base, price })));
    const rows = await handle.db.select().from(entries).where(eq(entries.productId, 'mykonos-reflection-teste'));
    expect(rows).toHaveLength(1);
    expect(prices).toContain(Number(rows[0]!.price));
    expect((await handle.db.select().from(productVariants).where(eq(productVariants.productId, 'mykonos-reflection-teste'))).length).toBe(2);
    expect((await handle.db.select().from(productImages).where(eq(productImages.productId, 'mykonos-reflection-teste'))).length).toBe(1);
  });

  it('duas pessoas pedindo o mesmo nome ao mesmo tempo: uma consegue, a outra recebe a frase', async () => {
    await handle.db.insert(users).values({ id: 'u_b', username: 'pessoab', displayName: 'B' });
    const other = await PostgresLibraryRepository.open(handle.db, 'u_b');
    const results = await Promise.allSettled([repo.updateMe({ username: 'disputado' }), other.updateMe({ username: 'disputado' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { message: 'Esse nome já está em uso.' } });
  });

  /** Todas as entradas apontam para versões que existem no MESMO produto (nenhuma chave estrangeira pendurada). */
  async function assertConsistent() {
    const es = await handle.db.select().from(entries);
    const vs = await handle.db.select().from(productVariants);
    for (const e of es) if (e.variantId) expect(vs.some((v) => v.productId === e.productId && v.id === e.variantId), `entrada ${e.id} → versão ${e.variantId}`).toBe(true);
    const keys = vs.map((v) => `${v.productId}|${v.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  }

  it('D — duas alterações simultâneas da MESMA entrada: sem erro, sem duplicata, estado final é uma das duas inteira (nunca mistura)', async () => {
    // Dois "servidores" (duas instâncias do repositório, conexões diferentes) gravando a mesma entrada ao mesmo tempo.
    const other = await PostgresLibraryRepository.open(handle.db, OWNER.id);
    const base = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const before = await repo.revision();
    const a = { ...base, personalRating: 'rebuy' as const, price: 10, priceNote: 'A' };
    const b = { ...base, personalRating: 'good' as const, price: 20, priceNote: 'B' };
    const results = await Promise.allSettled([repo.upsert(a), other.upsert(b)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']); // sem deadlock, sem timeout, sem rollback
    const rows = await handle.db.select().from(entries).where(eq(entries.id, base.id));
    expect(rows).toHaveLength(1);
    const final = [rows[0]!.rating, Number(rows[0]!.price), rows[0]!.priceNote];
    // Documento inteiro (PUT): vale a última gravação, e ela vale INTEIRA — nunca a nota de uma com o preço da outra.
    expect([JSON.stringify(['rebuy', 10, 'A']), JSON.stringify(['good', 20, 'B'])]).toContain(JSON.stringify(final));
    expect(await repo.revision()).toBe(before + 2); // as duas passaram, uma depois da outra
    await assertConsistent();
  });

  it('F — duas alterações simultâneas da MESMA versão (product_variant) pelo mesmo dono: uma inteira vence, nada duplica', async () => {
    const other = await PostgresLibraryRepository.open(handle.db, OWNER.id);
    const base = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const withPrice = (price: number) => ({ ...base, variants: base.variants.map((v) => (v.id === '58518844080473' ? { ...v, price } : v)) });
    const results = await Promise.allSettled([repo.upsert(withPrice(60)), other.upsert(withPrice(70))]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const vs = await handle.db.select().from(productVariants).where(eq(productVariants.productId, base.id));
    expect(vs).toHaveLength(2);
    expect(['60.00', '70.00']).toContain(vs.find((v) => v.id === '58518844080473')!.price);
    await assertConsistent();
  });

  it('F — duas PESSOAS alterando as versões do mesmo produto do catálogo ao mesmo tempo: sem deadlock, sem chave pendurada', async () => {
    // Pessoa B também tem o Reflection (catálogo compartilhado). A muda o preço da versão de 100 ml; B tira essa versão.
    await handle.db.insert(users).values({ id: 'u_b', username: 'pessoab', displayName: 'B' });
    const [mine] = await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste'));
    await handle.db.insert(entries).values({ ...mine!, id: 'b-reflection', userId: 'u_b' });
    const repoB = await PostgresLibraryRepository.open(handle.db, 'u_b');
    const a = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const b = (await repoB.list()).find((p) => p.id === 'b-reflection')!;
    const results = await Promise.allSettled([
      repo.upsert({ ...a, variants: a.variants.map((v) => (v.id === '58518844080473' ? { ...v, price: 61 } : v)) }),
      repoB.upsert({ ...b, variants: b.variants.filter((v) => v.id !== '58518844080473') }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    // Quem gravou por último decide o conjunto de versões; as duas entradas continuam apontando para a de 50 ml.
    const ids = (await handle.db.select().from(productVariants).where(eq(productVariants.productId, 'mykonos-reflection-teste'))).map((v) => v.id).sort();
    expect([JSON.stringify(['58518844047705']), JSON.stringify(['58518844047705', '58518844080473'])]).toContain(JSON.stringify(ids));
    await assertConsistent();
  });

  it('F — tirar uma versão que OUTRA pessoa escolheu: o banco recusa (chave estrangeira) e desfaz tudo, sem estado pela metade', async () => {
    await handle.db.insert(users).values({ id: 'u_b', username: 'pessoab', displayName: 'B' });
    const [mine] = await handle.db.select().from(entries).where(eq(entries.id, 'mykonos-reflection-teste'));
    // A pessoa B escolheu a de 100 ml.
    await handle.db.insert(entries).values({ ...mine!, id: 'b-reflection', userId: 'u_b', variantId: '58518844080473', volumeText: '100 ml', volumeMl: '100' });
    const a = (await repo.list()).find((p) => p.id === 'mykonos-reflection-teste')!;
    const snapshot = await loadLibrary(handle.db);
    const error = await pgError(repo.upsert({ ...a, name: 'Tentou tirar a versão da B', variants: a.variants.filter((v) => v.id !== '58518844080473') }));
    expect(error).toBe('23503');
    // ROLLBACK: nem o nome mudou, nem a versão sumiu.
    expect(diffLibraries(snapshot, await loadLibrary(handle.db))).toEqual([]);
    await assertConsistent();
  });
});

/* ------------------------------------------------------------------ só num servidor Postgres (Neon + pooler) */

describe.skipIf(!usingServer)('pooler: primitivas de concorrência numa conexão de servidor real', () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a URL de testes passa pelo pooler (host "-pooler"), como o app vai usar', () => {
    expect(serverTarget?.pooled, 'TEST_DATABASE_URL precisa ser a connection string COM pooler').toBe(true);
  });

  it('transação: erro no meio desfaz tudo', async () => {
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(users).values({ id: 'u_tx', username: 'transacao', displayName: 'T' });
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');
    expect(await handle.db.select().from(users).where(eq(users.id, 'u_tx'))).toEqual([]);
  });

  it('SELECT … FOR UPDATE segura a linha para outra conexão (NOWAIT recebe 55P03)', async () => {
    await handle.db.insert(users).values({ id: 'u_lock', username: 'travado', displayName: 'L' });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = handle.db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, 'u_lock')).for('update');
      await held;
    });
    await pause(300);
    const code = await pgError(handle.db.transaction(async (tx) => tx.execute(sql`select id from users where id = 'u_lock' for update nowait`)));
    release();
    await holder;
    expect(code).toBe('55P03');
    // Solta a trava ao terminar a transação: agora passa.
    await expect(handle.db.transaction(async (tx) => tx.execute(sql`select id from users where id = 'u_lock' for update nowait`))).resolves.toBeDefined();
  });

  it('pg_advisory_xact_lock vale entre conexões e é liberado no fim da transação', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = handle.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('perfumes:library-import'))`);
      await held;
    });
    await pause(300);
    const busy = (await handle.db.transaction(async (tx) => tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('perfumes:library-import')) as ok`))) as unknown as { rows: { ok: boolean }[] };
    release();
    await holder;
    const free = (await handle.db.transaction(async (tx) => tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('perfumes:library-import')) as ok`))) as unknown as { rows: { ok: boolean }[] };
    expect([busy.rows[0]!.ok, free.rows[0]!.ok]).toEqual([false, true]);
  });

  it('ON CONFLICT com 10 inserções simultâneas da mesma chave: uma linha só', async () => {
    await handle.db.insert(users).values({ id: 'u_c', username: 'conflito', displayName: 'C' });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handle.db
          .insert(users)
          .values({ id: 'u_c', username: 'conflito', displayName: `C${i}` })
          .onConflictDoUpdate({ target: users.id, set: { displayName: `C${i}` } }),
      ),
    );
    expect(await handle.db.select().from(users).where(eq(users.id, 'u_c'))).toHaveLength(1);
  });
});

describe('abrir o repositório', () => {
  it('banco sem usuário: explica que falta importar', async () => {
    await expect(PostgresLibraryRepository.open(handle.db)).rejects.toThrow(/db:import/);
  });

  it('mais de um usuário: exige PERFUMES_OWNER_ID (nenhum dono presumido)', async () => {
    await handle.db.insert(users).values([
      { id: 'a1', username: 'aaa', displayName: 'A' },
      { id: 'b1', username: 'bbb', displayName: 'B' },
    ]);
    await expect(PostgresLibraryRepository.open(handle.db)).rejects.toBeInstanceOf(OwnerNotFoundError);
    expect((await PostgresLibraryRepository.open(handle.db, 'b1')).ownerId).toBe('b1');
    await expect(PostgresLibraryRepository.open(handle.db, 'nao-existe')).rejects.toThrow(/não existe/);
  });
});

describe('credenciais nunca aparecem', () => {
  it('redactDbError tira URL, senha e usuário da mensagem', () => {
    const url = 'postgres://guilherme:s3nh4-Sup3r@ep-cool-123.eu-central-1.aws.neon.tech/perfumes?sslmode=require';
    const message = redactDbError(new Error(`password authentication failed for user "guilherme" at ${url} (s3nh4-Sup3r)`), url);
    expect(message).not.toMatch(/s3nh4-Sup3r|"guilherme"|postgres:\/\/guilherme/);
    expect(redactDbError(new Error('conexão recusada: postgresql://x:y@h/db'))).toBe('conexão recusada: postgres://[removido]');
  });
});

describe('arquivo de dados real (só roda onde existe data/library.json)', () => {
  it('biblioteca real: validação sem problemas', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const file = path.join('data', 'library.json');
    if (!existsSync(file)) return;
    const { resolveImageFile } = await import('../apps/server/src/db/checks');
    const v = validateLibrary(JSON.parse(readFileSync(file, 'utf8')), resolveImageFile);
    expect(v.problems).toEqual([]);
  });
});

