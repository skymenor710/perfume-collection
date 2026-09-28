import { LIBRARY_SCHEMA, type Library } from '@perfumes/core/library';
import type { Db } from './client';
import { rowsToLibrary } from './mapping';
import { entries, productImages, products, productVariants, users } from './schema';

/**
 * O banco inteiro como uma `Library` (o mesmo formato do data/library.json). Usado para verificar a migração,
 * exportar cópia de segurança e comparar JSON × Postgres. Ordem estável (por id) para o resultado ser determinístico.
 */
export async function loadLibrary(db: Db): Promise<Library> {
  const [u, p, v, i, e] = await Promise.all([
    db.select().from(users),
    db.select().from(products),
    db.select().from(productVariants),
    db.select().from(productImages),
    db.select().from(entries),
  ]);
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  const lib = rowsToLibrary({ users: u, products: p, variants: v, images: i, entries: e });
  return { schemaVersion: LIBRARY_SCHEMA, users: byId(lib.users), products: byId(lib.products), entries: byId(lib.entries) };
}

/** A mesma biblioteca com usuários, produtos e entradas em ordem de id (para comparar com o banco). */
export function sortedLibrary(lib: Library): Library {
  const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: lib.schemaVersion, users: byId(lib.users), products: byId(lib.products), entries: byId(lib.entries) };
}
