import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyPerfumeView,
  fromPerfume,
  LIBRARY_SCHEMA,
  publicLists,
  referencedImages,
  sanitizeLibrary,
  sanitizeUser,
  toPerfumeView,
  toPublicView,
  validateUsername,
  type Entry,
  type Library,
  type ListKind,
  type User,
} from '@perfumes/core/library';
import { sanitizePerfume, sortPerfumes, type Perfume } from '@perfumes/core/perfume';
import { config } from './config';
import { event } from './log';
import type { LibraryRepository, OwnerPatch } from './repositories/library';
import { mediaSettings, seedRefs } from './media/content';
import { libraryViews, nextOwner, seedUpgrades, type SeedRefs } from './repositories/rules';

/**
 * JsonLibraryRepository: biblioteca em três entidades (usuários · produtos · entradas) num JSON gravado de forma
 * atômica (arquivo temporário + rename). É o backend `STORAGE_BACKEND=json` — e o formato de cópia de segurança do
 * Postgres (`npm run db:export` gera o mesmo arquivo).
 *
 * Migração (schema 1 → 2): na primeira execução com dados antigos, data/perfumes.json vira data/library.json; o
 * arquivo antigo fica guardado como data/perfumes.v1-<data>.json (nunca é apagado).
 */

let library: Library = { schemaVersion: LIBRARY_SCHEMA, users: [], products: [], entries: [] };
let revision = 0;
const listeners = new Set<(revision: number) => void>();

const libraryFile = () => path.join(config.dataDir, 'library.json');
const legacyFile = () => path.join(config.dataDir, 'perfumes.json');

export function readPerfumes(filePath: string): Perfume[] {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { perfumes?: unknown }).perfumes) ? (raw as { perfumes: unknown[] }).perfumes : [];
  return list.map(sanitizePerfume).filter((p): p is Perfume => p !== null);
}

function newOwner(): User {
  const check = validateUsername(config.ownerUsername);
  return sanitizeUser({
    id: `u_${randomBytes(8).toString('hex')}`,
    username: check.ok ? check.username : 'colecao',
    displayName: config.ownerDisplayName,
  })!;
}

function fromViews(views: Perfume[], owner: User): Library {
  const split = views.map((p) => fromPerfume(p, owner.id));
  return { schemaVersion: LIBRARY_SCHEMA, users: [owner], products: split.map((s) => s.product), entries: split.map((s) => s.entry) };
}

export function loadStore() {
  const target = libraryFile();
  if (existsSync(target)) {
    try {
      const { library: loaded, dropped } = sanitizeLibrary(JSON.parse(readFileSync(target, 'utf8')));
      library = loaded;
      if (dropped) event('library.invalid_entries', { dropped }, 'warn');
    } catch (error) {
      // Arquivo corrompido: guarda uma cópia e recomeça do arquivo antigo (se houver) ou da planilha.
      const backup = `${target}.corrompido-${Date.now()}`;
      renameSync(target, backup);
      event('library.unreadable', { reason: (error as Error).message, backup: path.basename(backup) }, 'error');
      library = fromViews(existsSync(legacyFile()) ? readPerfumes(legacyFile()) : readPerfumes(config.seedFile), newOwner());
    }
  } else if (existsSync(legacyFile())) {
    // MIGRAÇÃO 1 → 2: mesmos IDs, mesmos dados (há teste de ida e volta); o arquivo antigo fica guardado.
    const views = readPerfumes(legacyFile());
    library = fromViews(views, newOwner());
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    copyFileSync(legacyFile(), path.join(config.dataDir, `perfumes.v1-${stamp}.json`));
    writeLibrary();
    renameSync(legacyFile(), path.join(config.dataDir, `perfumes.v1-migrado.json`));
    event('library.migrated', { schema: LIBRARY_SCHEMA, products: library.products.length, entries: library.entries.length });
  } else {
    library = fromViews(readPerfumes(config.seedFile), newOwner());
  }
  if (library.users.length === 0) library.users.push(newOwner());
  upgradeFromSeed();
  persist();
}

const owner = () => library.users[0];
const productOf = (entry: Entry) => library.products.find((p) => p.id === entry.productId) ?? null;
const viewOf = (entry: Entry) => {
  const product = productOf(entry);
  return product ? toPerfumeView(entry, product) : null;
};

/** Atualização pela planilha (regra em rules.ts), gravada de uma vez só. */
function upgradeFromSeed() {
  let seed: Perfume[];
  let refs: SeedRefs;
  try {
    seed = readPerfumes(config.seedFile);
    refs = seedRefs(mediaSettings());
  } catch (error) {
    // Sem semente, ou mapa de migração ilegível: não atualiza (nunca adivinha qual foto é qual).
    if (!(error instanceof Error && /Mapa de migração/.test(error.message))) return;
    event('library.upgraded', { skipped: error.message }, 'warn');
    return;
  }
  const upgrades = seedUpgrades(libraryViews(library, owner().id), seed, refs);
  for (const next of upgrades) write(next);
  if (upgrades.length) event('library.upgraded', { upgraded: upgrades.length, assetVersion: seed[0]?.assetVersion });
}

/** Grava uma visão: separa em produto + entrada do dono. */
function write(view: Perfume) {
  const entryIndex = library.entries.findIndex((e) => e.id === view.id && e.userId === owner().id);
  const existing = entryIndex >= 0 ? { entry: library.entries[entryIndex], product: productOf(library.entries[entryIndex])! } : null;
  const { product, entry } = applyPerfumeView(existing && existing.product ? existing : null, view, owner().id);
  const productIndex = library.products.findIndex((p) => p.id === product.id);
  if (productIndex >= 0) library.products[productIndex] = product;
  else library.products.push(product);
  if (entryIndex >= 0) library.entries[entryIndex] = entry;
  else library.entries.push(entry);
}

function writeLibrary() {
  const target = libraryFile();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(library, null, 2)}\n`);
  renameSync(tmp, target);
}

function persist() {
  writeLibrary();
  revision++;
  for (const listener of listeners) listener(revision);
}

export type { OwnerPatch };

/** Implementação em arquivo (data/library.json) da porta LibraryRepository. */
export const store: LibraryRepository = {
  backend: 'json',
  /** A coleção do dono, como a interface usa (visões). */
  list: async () => libraryViews(library, owner().id),
  revision: async () => revision,
  async upsert(perfume: Perfume) {
    write(perfume);
    persist();
    return viewOf(library.entries.find((e) => e.id === perfume.id)!) ?? perfume;
  },
  async remove(id: string) {
    const index = library.entries.findIndex((e) => e.id === id && e.userId === owner().id);
    if (index < 0) return false;
    const [entry] = library.entries.splice(index, 1);
    // Produto sem nenhuma entrada sai do catálogo (as fotos dele saem na próxima limpeza de mídia).
    if (!library.entries.some((e) => e.productId === entry.productId)) library.products = library.products.filter((p) => p.id !== entry.productId);
    persist();
    return true;
  },
  subscribe(listener: (revision: number) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /* ---------------------------------------------------------------- usuário */
  me: async (): Promise<User> => owner(),
  async updateMe(patch: OwnerPatch): Promise<User> {
    const current = owner();
    const next = await nextOwner(current, patch, (username) => library.users.some((u) => u.id !== current.id && u.username === username));
    library.users[0] = next;
    persist();
    return next;
  },

  /* ---------------------------------------------------------------- público (sem conta) */
  async publicProfile(username: string) {
    const user = library.users.find((u) => u.username === username.toLowerCase());
    if (!user) return null;
    const lists = publicLists(user);
    if (user.privacy.profile !== 'public' && lists.length === 0) return null;
    return { user, lists };
  },
  async publicList(username: string, list: ListKind) {
    const user = library.users.find((u) => u.username === username.toLowerCase());
    if (!user || user.privacy[list] !== 'public') return null;
    return sortPerfumes(
      library.entries
        .filter((e) => e.userId === user.id && e.list === list)
        .map(viewOf)
        .filter((v): v is Perfume => v !== null)
        .map(toPublicView),
    );
  },
  async isPublicMedia(ref: string) {
    for (const user of library.users) {
      for (const list of publicLists(user)) {
        for (const e of library.entries) {
          if (e.userId !== user.id || e.list !== list) continue;
          const p = productOf(e);
          if (p?.images.some((i) => i.url === ref || i.thumbUrl === ref || i.masterUrl === ref)) return true;
        }
      }
    }
    return false;
  },
  referenced: async () => referencedImages(library),
  products: async () => library.products,
};
