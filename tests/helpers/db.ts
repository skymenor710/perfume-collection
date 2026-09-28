import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { fromPerfume, LIBRARY_SCHEMA, type Library, type User } from '@perfumes/core/library';
import { sanitizePerfume, type Perfume } from '@perfumes/core/perfume';
import { readEnvFile } from '../../apps/server/src/config';
import { applyMigrations, openDb, type DbHandle } from '../../apps/server/src/db/client';
import { checkTestTarget, describeTarget } from '../../apps/server/src/db/targets';
import seed from '../../apps/web/src/data/seed.json';

/**
 * Banco de teste de VERDADE: PGlite (o Postgres compilado para WebAssembly, em memória) por padrão, ou um servidor
 * Postgres em TEST_DATABASE_URL — que precisa ser um banco EXCLUSIVO de testes, num branch SEPARADO do Neon: os
 * testes apagam tudo nele.
 *
 * `npm run test:neon` liga o servidor (PERFUMES_TEST_NEON=1, lendo o .env.local). Antes de qualquer coisa, a URL de
 * testes é comparada com as do banco principal (mesmo banco OU mesmo endpoint/branch = recusa) — o principal nunca
 * recebe teste destrutivo nem concorrente.
 */
const fileEnv = process.env.PERFUMES_TEST_NEON === '1' ? readEnvFile() : {};
const pick = (k: string) => (process.env[k]?.trim() || fileEnv[k] || '').trim();
const TEST_URL = process.env.PERFUMES_TEST_NEON === '1' || process.env.TEST_DATABASE_URL ? pick('TEST_DATABASE_URL') : '';
if (process.env.PERFUMES_TEST_NEON === '1' || TEST_URL) {
  const check = checkTestTarget(pick, { requirePooler: true });
  if (!check.ok) throw new Error(`Testes no servidor Postgres RECUSADOS:\n  ${check.refusals.join('\n  ')}`);
}

export const usingServer = Boolean(TEST_URL);
/** Host mascarado e se passa pelo pooler (para o relatório; nunca a URL). */
export const serverTarget = TEST_URL ? describeTarget(TEST_URL) : null;

export async function freshDb(): Promise<DbHandle> {
  if (!TEST_URL) {
    const handle = await openDb('pglite:memory');
    await applyMigrations(handle);
    return handle;
  }
  // Confere de novo imediatamente antes do DROP (nunca apaga nada sem a validação completa).
  const again = checkTestTarget(pick, { requirePooler: true });
  if (!again.ok) throw new Error(`DROP SCHEMA recusado:\n  ${again.refusals.join('\n  ')}`);
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
