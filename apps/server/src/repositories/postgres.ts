import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { applyPerfumeView, publicLists, toPublicView, type Entry, type ListKind, type Product, type User } from '@perfumes/core/library';
import { sortPerfumes, type Perfume } from '@perfumes/core/perfume';
import type { Db } from '../db/client';
import { entryToRow, productToRows, rowsToProduct, rowToEntry, rowToUser, userToRow, type EntryRecord } from '../db/mapping';
import { entries, productImages, products, productVariants, users } from '../db/schema';
import type { LibraryRepository, OwnerPatch } from './library';
import { nextOwner, viewsOf } from './rules';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Exec = Db | Tx;

/** Violação de unicidade do Postgres (23505). */
const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class OwnerNotFoundError extends Error {}

export class EntryOwnershipError extends Error {
  constructor(id: string) {
    super(`A entrada ${id} pertence a outra pessoa.`);
  }
}

/**
 * PostgresLibraryRepository — mesmo contrato e mesmas regras (rules.ts, core) do JSON; muda só onde os dados moram.
 *
 * Concorrência: toda gravação é UMA transação que começa travando a linha do dono (`SELECT … FOR UPDATE`). Duas
 * gravações simultâneas da mesma pessoa acontecem uma depois da outra (sem atualização perdida), e a revisão sobe
 * junto, na mesma transação. O banco é a última linha de defesa: chaves primárias, únicos (entrada por
 * pessoa+produto+lista, imagem por produto+referência, versão por produto) e chaves estrangeiras compostas (a versão
 * escolhida é sempre do mesmo produto) recusam o que a aplicação deixasse passar.
 *
 * Avisos de revisão (SSE) valem para este processo. Com várias instâncias (FASE 5), entram LISTEN/NOTIFY.
 */
export class PostgresLibraryRepository implements LibraryRepository {
  readonly backend = 'postgres' as const;
  private readonly listeners = new Set<(revision: number) => void>();

  private constructor(
    private readonly db: Db,
    readonly ownerId: string,
  ) {}

  /**
   * Abre o repositório do dono desta instalação. Sem `ownerId`: o banco precisa ter exatamente um usuário
   * (nenhuma tabela assume quem é o dono — quem decide é a configuração).
   */
  static async open(db: Db, ownerId?: string | null): Promise<PostgresLibraryRepository> {
    if (ownerId) {
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId));
      if (!row) throw new OwnerNotFoundError(`Usuário ${ownerId} (PERFUMES_OWNER_ID) não existe no banco.`);
      return new PostgresLibraryRepository(db, row.id);
    }
    const rows = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt)).limit(2);
    if (rows.length === 0) throw new OwnerNotFoundError('O banco não tem nenhum usuário: rode `npm run db:import` antes de usar STORAGE_BACKEND=postgres.');
    if (rows.length > 1) throw new OwnerNotFoundError('O banco tem mais de um usuário: defina PERFUMES_OWNER_ID com o id do dono desta instalação.');
    return new PostgresLibraryRepository(db, rows[0]!.id);
  }

  /* ---------------------------------------------------------------- leitura */

  /** Produtos completos (com versões e imagens em ordem) pelos ids. */
  private async loadProducts(exec: Exec, ids: string[]): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const [ps, vs, is] = await Promise.all([
      exec.select().from(products).where(inArray(products.id, unique)),
      exec.select().from(productVariants).where(inArray(productVariants.productId, unique)),
      exec.select().from(productImages).where(inArray(productImages.productId, unique)),
    ]);
    return new Map(
      ps.map((p) =>
        [
          p.id,
          rowsToProduct(
            p,
            vs.filter((v) => v.productId === p.id),
            is.filter((i) => i.productId === p.id),
          ),
        ] as const,
      ),
    );
  }

  private async views(exec: Exec, entryRows: EntryRecord[], userId: string): Promise<Perfume[]> {
    const entryList = entryRows.map(rowToEntry);
    const productMap = await this.loadProducts(
      exec,
      entryList.map((e) => e.productId),
    );
    return viewsOf(entryList, (id) => productMap.get(id), userId);
  }

  async list(): Promise<Perfume[]> {
    const rows = await this.db.select().from(entries).where(eq(entries.userId, this.ownerId));
    return this.views(this.db, rows, this.ownerId);
  }

  async revision(): Promise<number> {
    const [row] = await this.db.select({ revision: users.libraryRevision }).from(users).where(eq(users.id, this.ownerId));
    return row?.revision ?? 0;
  }

  /* ---------------------------------------------------------------- escrita */

  /** Trava o dono (serializa as gravações da pessoa) e devolve a linha atual. */
  private async lockOwner(tx: Tx) {
    const [row] = await tx.select().from(users).where(eq(users.id, this.ownerId)).for('update');
    if (!row) throw new OwnerNotFoundError('O dono desta instalação sumiu do banco.');
    return row;
  }

  private async bumpRevision(tx: Tx): Promise<number> {
    const [row] = await tx
      .update(users)
      .set({ libraryRevision: sql`${users.libraryRevision} + 1` })
      .where(eq(users.id, this.ownerId))
      .returning({ revision: users.libraryRevision });
    return row!.revision;
  }

  private notify(revision: number) {
    for (const listener of this.listeners) listener(revision);
  }

  /**
   * Grava o produto inteiro: linha do produto, versões (upsert pela chave produto+id) e imagens (upsert pela chave
   * produto+referência). A entrada é gravada ENTRE a inclusão das versões novas e a remoção das que saíram — assim a
   * chave estrangeira da versão escolhida vale o tempo todo.
   */
  private async writeProduct(tx: Tx, product: Product, entry: Entry) {
    const rows = productToRows(product);
    const { id: _id, createdAt: _created, ...productUpdate } = rows.product;
    await tx.insert(products).values(rows.product).onConflictDoUpdate({ target: products.id, set: productUpdate });
    for (const v of rows.variants) {
      const { productId: _p, id: _v, ...variantUpdate } = v;
      await tx.insert(productVariants).values(v).onConflictDoUpdate({ target: [productVariants.productId, productVariants.id], set: variantUpdate });
    }
    for (const i of rows.images) {
      const { productId: _p, ref: _r, ...imageUpdate } = i;
      await tx.insert(productImages).values(i).onConflictDoUpdate({ target: [productImages.productId, productImages.ref], set: imageUpdate });
    }
    const entryRow = entryToRow(entry);
    const { id: _e, ...entryUpdate } = entryRow;
    await tx.insert(entries).values(entryRow).onConflictDoUpdate({ target: entries.id, set: entryUpdate });
    await tx.delete(productImages).where(and(eq(productImages.productId, product.id), notInArray(productImages.ref, rows.images.length ? rows.images.map((i) => i.ref) : [''])));
    await tx
      .delete(productVariants)
      .where(and(eq(productVariants.productId, product.id), notInArray(productVariants.id, rows.variants.length ? rows.variants.map((v) => v.id) : [''])));
  }

  async upsert(perfume: Perfume): Promise<Perfume> {
    const revision = await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const [current] = await tx.select().from(entries).where(eq(entries.id, perfume.id));
      // Id de entrada de OUTRA pessoa: recusa (nunca sobrescreve dado alheio).
      if (current && current.userId !== this.ownerId) throw new EntryOwnershipError(perfume.id);
      let existing: { product: Product; entry: Entry } | null = null;
      if (current) {
        const product = (await this.loadProducts(tx, [current.productId])).get(current.productId);
        if (product) existing = { product, entry: rowToEntry(current) };
      }
      const { product, entry } = applyPerfumeView(existing, perfume, this.ownerId);
      await this.writeProduct(tx, product, entry);
      return this.bumpRevision(tx);
    });
    this.notify(revision);
    const [row] = await this.db
      .select()
      .from(entries)
      .where(and(eq(entries.id, perfume.id), eq(entries.userId, this.ownerId)));
    return row ? ((await this.views(this.db, [row], this.ownerId))[0] ?? perfume) : perfume;
  }

  async remove(id: string): Promise<boolean> {
    const revision = await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const [removed] = await tx
        .delete(entries)
        .where(and(eq(entries.id, id), eq(entries.userId, this.ownerId)))
        .returning({ productId: entries.productId });
      if (!removed) return null;
      // Produto sem nenhuma entrada sai do catálogo (versões e imagens vão junto; os arquivos, na limpeza de mídia).
      const [still] = await tx.select({ id: entries.id }).from(entries).where(eq(entries.productId, removed.productId)).limit(1);
      if (!still) await tx.delete(products).where(eq(products.id, removed.productId));
      return this.bumpRevision(tx);
    });
    if (revision === null) return false;
    this.notify(revision);
    return true;
  }

  subscribe(listener: (revision: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------------- usuário */

  async me(): Promise<User> {
    const [row] = await this.db.select().from(users).where(eq(users.id, this.ownerId));
    if (!row) throw new OwnerNotFoundError('O dono desta instalação sumiu do banco.');
    return rowToUser(row);
  }

  async updateMe(patch: OwnerPatch): Promise<User> {
    let result: { user: User; revision: number };
    try {
      result = await this.db.transaction(async (tx) => {
        const current = rowToUser(await this.lockOwner(tx));
        const next = await nextOwner(current, patch, async (username) => {
          const [taken] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(sql`lower(${users.username}) = ${username}`, sql`${users.id} <> ${this.ownerId}`))
            .limit(1);
          return Boolean(taken);
        });
        const { id: _id, createdAt: _c, ...update } = userToRow(next);
        await tx.update(users).set(update).where(eq(users.id, this.ownerId));
        return { user: next, revision: await this.bumpRevision(tx) };
      });
    } catch (error) {
      // Duas pessoas pegando o mesmo nome ao mesmo tempo: o índice único decide, e a frase é a mesma.
      if (isUniqueViolation(error)) throw new Error('Esse nome já está em uso.');
      throw error;
    }
    this.notify(result.revision);
    return result.user;
  }

  /* ---------------------------------------------------------------- público (sem conta) */

  private async userByUsername(username: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username.toLowerCase()));
    return row ? rowToUser(row) : null;
  }

  async publicProfile(username: string) {
    const user = await this.userByUsername(username);
    if (!user) return null;
    const lists = publicLists(user);
    if (user.privacy.profile !== 'public' && lists.length === 0) return null;
    return { user, lists };
  }

  async publicList(username: string, list: ListKind) {
    const user = await this.userByUsername(username);
    if (!user || user.privacy[list] !== 'public') return null;
    const rows = await this.db
      .select()
      .from(entries)
      .where(and(eq(entries.userId, user.id), eq(entries.list, list)));
    return sortPerfumes((await this.views(this.db, rows, user.id)).map(toPublicView));
  }

  async isPublicMedia(ref: string) {
    const [hit] = await this.db
      .select({ one: sql<number>`1` })
      .from(productImages)
      .innerJoin(entries, eq(entries.productId, productImages.productId))
      .innerJoin(users, eq(users.id, entries.userId))
      .where(
        and(
          or(eq(productImages.ref, ref), eq(productImages.thumbRef, ref), eq(productImages.masterRef, ref)),
          or(and(eq(entries.list, 'wishlist'), eq(users.privacyWishlist, 'public')), and(eq(entries.list, 'collection'), eq(users.privacyCollection, 'public'))),
        ),
      )
      .limit(1);
    return Boolean(hit);
  }

  async referenced() {
    const [imgs, avatars] = await Promise.all([
      this.db.select({ ref: productImages.ref, thumb: productImages.thumbRef, master: productImages.masterRef }).from(productImages),
      this.db.select({ avatar: users.avatarRef }).from(users),
    ]);
    const out = new Set<string>();
    for (const i of imgs) for (const r of [i.ref, i.thumb, i.master]) if (r) out.add(r);
    for (const a of avatars) if (a.avatar) out.add(a.avatar);
    return out;
  }

  async products() {
    const ids = (await this.db.select({ id: products.id }).from(products)).map((p) => p.id);
    return [...(await this.loadProducts(this.db, ids)).values()];
  }
}
