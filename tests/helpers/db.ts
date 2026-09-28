import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { fromPerfume, LIBRARY_SCHEMA, type Library, type User } from '@perfumes/core/library';
import { sanitizePerfume, type Perfume } from '@perfumes/core/perfume';
import { applyMigrations, openDb, type DbHandle } from '../../apps/server/src/db/client';
import seed from '../../apps/web/src/data/seed.json';

/**
 * Banco de teste de VERDADE: PGlite (o Postgres compilado para WebAssembly, em memória) por padrão, ou um servidor
 * Postgres em TEST_DATABASE_URL — que precisa ser um banco EXCLUSIVO de testes: os testes apagam tudo nele.
 */
const TEST_URL = process.env.TEST_DATABASE_URL?.trim() || '';
if (TEST_URL && TEST_URL === process.env.DATABASE_URL?.trim()) throw new Error('TEST_DATABASE_URL não pode ser o mesmo banco de DATABASE_URL.');

export const usingServer = Boolean(TEST_URL);

export async function freshDb(): Promise<DbHandle> {
  if (!TEST_URL) {
    const handle = await openDb('pglite:memory');
    await applyMigrations(handle);
    return handle;
  }
  const handle = await openDb(TEST_URL, { max: 10 });
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await applyMigrations(handle);
  return handle;
}

export const OWNER: User = {
  id: 'u_teste_dono',
  username: 'dono',
  displayName: 'Dono',
  avatarUrl: null,
  bio: null,
  privacy: { profile: 'private', wishlist: 'private', collection: 'private' },
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

export const seedPerfumes = (): Perfume[] => (seed as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);

/**
 * Um perfume com duas versões (50 e 100 ml), a de 50 escolhida e a foto ligada a ela — o caso do Mykonos Reflection.
 * Mais um com "50/100 ml" ainda sem escolha (o caso do Empire) e um em IDR.
 */
export function specialPerfumes(): Perfume[] {
  const base = seedPerfumes()[0]!;
  const at = '2026-09-20T12:00:00.000Z';
  return [
    sanitizePerfume({
      ...base,
      id: 'mykonos-reflection-teste',
      name: 'Reflection',
      brand: 'Mykonos',
      volume: '50 ml',
      price: 35.95,
      currency: 'EUR',
      imageUrl: 'media/reflection-50-lg.webp',
      thumbUrl: 'media/reflection-50-sm.webp',
      masterUrl: 'media/reflection-50.png',
      variants: [
        { id: '58518844047705', label: '50 ml', volume: '50 ml', price: 35.95, currency: 'EUR', sku: null, available: true, url: 'https://loja.test/p?variant=58518844047705' },
        { id: '58518844080473', label: '100 ml', volume: '100 ml', price: 49.95, currency: 'EUR', sku: null, available: true, url: 'https://loja.test/p?variant=58518844080473' },
      ],
      selectedVariantId: '58518844047705',
      variantUrl: 'https://loja.test/p?variant=58518844047705',
      origin: 'url-import',
      order: 500,
      createdAt: at,
      updatedAt: at,
    })!,
    sanitizePerfume({
      ...base,
      id: 'empire-teste',
      name: 'Empire',
      brand: 'Mykonos x RRQ',
      volume: '50/100 ml',
      price: null,
      currency: null,
      imageUrl: 'media/empire-lg.webp',
      thumbUrl: 'media/empire-sm.webp',
      masterUrl: null,
      variants: [
        { id: 'e50', label: '50 ml', volume: '50 ml', price: 499000, currency: 'IDR', sku: 'E-50', available: true, url: null },
        { id: 'e100', label: '100 ml', volume: '100 ml', price: 859000, currency: 'IDR', sku: 'E-100', available: false, url: null },
      ],
      selectedVariantId: null,
      variantUrl: null,
      origin: 'url-import',
      order: 510,
      createdAt: at,
      updatedAt: at,
    })!,
  ];
}

/** Biblioteca de teste: a semente (15 perfumes) + os casos especiais, de um dono só. */
export function fixtureLibrary(owner: User = OWNER): Library {
  const split = [...seedPerfumes(), ...specialPerfumes()].map((p) => fromPerfume(p, owner.id));
  return { schemaVersion: LIBRARY_SCHEMA, users: [owner], products: split.map((s) => s.product), entries: split.map((s) => s.entry) };
}

/** Pasta com um arquivo para cada imagem referenciada (a importação exige os arquivos). */
export function imageFolder(lib: Library): (ref: string) => string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'perfumes-img-'));
  for (const p of lib.products)
    for (const i of p.images)
      for (const ref of [i.url, i.thumbUrl, i.masterUrl]) {
        if (!ref) continue;
        mkdirSync(path.dirname(path.join(root, ref)), { recursive: true });
        writeFileSync(path.join(root, ref), `imagem ${ref}`);
      }
  return (ref) => path.join(root, ref);
}
