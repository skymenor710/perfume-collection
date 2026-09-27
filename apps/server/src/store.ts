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
  type Privacy,
  type Product,
  type User,
} from '@perfumes/core/library';
import { sanitizePerfume, sortPerfumes, type Perfume } from '@perfumes/core/perfume';
import { config } from './config';

/**
 * Armazenamento: biblioteca em três entidades (usuários · produtos · entradas) num JSON gravado de forma atômica
 * (arquivo temporário + rename). A API continua entregando a "visão" Perfume, então a interface não muda.
 *
 * Migração (schema 1 → 2): na primeira execução com dados antigos, data/perfumes.json vira data/library.json; o
 * arquivo antigo fica guardado como data/perfumes.v1-<data>.json (nunca é apagado). Ver docs/ARCHITECTURE.md.
 */

let library: Library = { schemaVersion: LIBRARY_SCHEMA, users: [], products: [], entries: [] };
let revision = 0;
const listeners = new Set<(revision: number) => void>();

const libraryFile = () => path.join(config.dataDir, 'library.json');
const legacyFile = () => path.join(config.dataDir, 'perfumes.json');

function readPerfumes(filePath: string): Perfume[] {
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
      if (dropped) console.warn(`[coleção] ${dropped} entradas inválidas ignoradas em data/library.json.`);
    } catch (error) {
      // Arquivo corrompido: guarda uma cópia e recomeça do arquivo antigo (se houver) ou da planilha.
      const backup = `${target}.corrompido-${Date.now()}`;
      renameSync(target, backup);
      console.error(`[coleção] data/library.json ilegível (${(error as Error).message}); cópia em ${backup}.`);
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
    console.log(`[coleção] migrada para o schema ${LIBRARY_SCHEMA}: ${library.products.length} produtos, ${library.entries.length} entradas, usuário "${library.users[0].username}".`);
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
const ownerViews = () =>
  sortPerfumes(
    library.entries
      .filter((e) => e.userId === owner().id)
      .map(viewOf)
      .filter((v): v is Perfume => v !== null),
  );

/**
 * A semente (os da planilha) foi reprocessada com um pipeline mais novo? Os perfumes guardados que vieram dela
 * recebem fotos, cores e perfil olfativo novos — sem perder o que é da pessoa. Perfumes que a pessoa removeu
 * não voltam.
 */
function upgradeFromSeed() {
  let seed: Perfume[];
  try {
    seed = readPerfumes(config.seedFile);
  } catch {
    return;
  }
  let upgraded = 0;
  for (const s of seed) {
    const entry = library.entries.find((e) => e.id === s.id && e.userId === owner().id);
    const p = entry ? viewOf(entry) : null;
    if (!entry || !p || p.origin !== 'google-sheet') continue;
    // Versão mais nova, ou a mesma versão reprocessada (a foto da semente mudou de arquivo). Foto trocada pela
    // pessoa (media/…) não é da semente e fica.
    const seedPhotoChanged = p.imageUrl?.startsWith('bottles/') && p.imageUrl !== s.imageUrl;
    // Semente que passou a conhecer as versões do produto (50/100 ml) também atualiza: o app precisa perguntar.
    const seedLearnedVariants = s.variants.length > 1 && p.variants.length === 0;
    if (p.assetVersion >= s.assetVersion && !seedPhotoChanged && !seedLearnedVariants) continue;
    const next: Perfume = {
      ...p,
      imageUrl: s.imageUrl,
      thumbUrl: s.thumbUrl,
      dominantColor: s.dominantColor,
      dominantColorOverride: s.dominantColorOverride,
      accentColor: s.accentColor,
      accentGlow: s.accentGlow,
      imageSource: s.imageSource,
      imageCredit: s.imageCredit,
      masterUrl: s.masterUrl,
      fieldSources: { ...p.fieldSources, ...s.fieldSources },
      // Variante: vai inteira (tamanho + preço + link) ou não vai — nunca a foto de uma com o preço de outra.
      variants: s.variants,
      selectedVariantId: s.selectedVariantId,
      variantUrl: s.variantUrl,
      ...(s.selectedVariantId ? { volume: s.volume, price: s.price, currency: s.currency, priceNote: s.priceNote } : {}),
      olfactoryProfile: s.olfactoryProfile,
      description: p.description ?? s.description,
      gender: p.gender ?? s.gender,
      assetVersion: s.assetVersion,
    };
    write(next);
    upgraded++;
  }
  if (upgraded) console.log(`[coleção] ${upgraded} perfumes da planilha atualizados para a versão ${seed[0]?.assetVersion} das fotos e do perfil olfativo.`);
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

export type OwnerPatch = Partial<Pick<User, 'username' | 'displayName' | 'bio'>> & { privacy?: Partial<Privacy> };

export const store = {
  /** A coleção do dono, como a interface usa (visões). */
  list: ownerViews,
  revision: () => revision,
  upsert(perfume: Perfume) {
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
  me: (): User => owner(),
  updateMe(patch: OwnerPatch): User {
    const current = owner();
    let username = current.username;
    if (patch.username !== undefined) {
      const check = validateUsername(patch.username);
      if (!check.ok) throw new Error(check.message);
      if (library.users.some((u) => u.id !== current.id && u.username === check.username)) throw new Error('Esse nome já está em uso.');
      username = check.username;
    }
    const next = sanitizeUser({
      ...current,
      username,
      displayName: patch.displayName ?? current.displayName,
      bio: patch.bio === undefined ? current.bio : patch.bio,
      privacy: { ...current.privacy, ...patch.privacy },
      updatedAt: new Date().toISOString(),
    });
    if (!next) throw new Error('Dados de perfil inválidos.');
    library.users[0] = next;
    persist();
    return next;
  },

  /* ---------------------------------------------------------------- público (sem conta) */
  /** Perfil público de um username, com as listas que ele abriu. Nulo quando não existe ou é privado. */
  publicProfile(username: string): { user: User; lists: ListKind[] } | null {
    const user = library.users.find((u) => u.username === username.toLowerCase());
    if (!user) return null;
    const lists = publicLists(user);
    if (user.privacy.profile !== 'public' && lists.length === 0) return null;
    return { user, lists };
  },
  /** Uma lista pública, como visões públicas (sem observações nem fontes internas). */
  publicList(username: string, list: ListKind): Perfume[] | null {
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
  /** Arquivo de /media que aparece em alguma lista pública (pode ser servido sem código de acesso). */
  isPublicMedia(ref: string): boolean {
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
  /** Todas as imagens em uso (a limpeza de mídia não toca nelas). */
  referenced: () => referencedImages(library),
  products: (): readonly Product[] => library.products,
};
