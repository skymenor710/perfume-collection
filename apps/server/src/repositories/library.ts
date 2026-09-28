import type { ListKind, Privacy, Product, User } from '@perfumes/core/library';
import type { Perfume } from '@perfumes/core/perfume';

/**
 * Porta de persistência da biblioteca (usuários, produtos, entradas). Duas implementações, escolhidas por
 * `STORAGE_BACKEND` (repositories/index.ts):
 *
 *   json      → JsonLibraryRepository (store.ts): data/library.json
 *   postgres  → PostgresLibraryRepository (repositories/postgres.ts): Neon (ou PGlite local no ensaio/testes)
 *
 * Rotas, jobs e páginas públicas só conhecem ESTE contrato. As regras comuns (visões, perfil, atualização pela
 * planilha) estão em rules.ts e são as mesmas nas duas.
 *
 * O contrato é assíncrono (banco é assíncrono). A instância é do dono desta instalação (enquanto não há contas);
 * com contas (FASE 6), os métodos ganham `userId` vindo da sessão.
 *
 * Não existe implementação "de mentira" que finja ser banco: os testes usam as duas implementações reais
 * (arquivo numa pasta temporária; Postgres via PGlite ou TEST_DATABASE_URL).
 */

export type OwnerPatch = Partial<Pick<User, 'username' | 'displayName' | 'bio'>> & { privacy?: Partial<Privacy> };

export interface LibraryRepository {
  readonly backend: 'json' | 'postgres';
  /** A coleção do dono, como a interface usa (visões), já ordenada. */
  list(): Promise<Perfume[]>;
  /** Número que muda a cada gravação (sincronização entre abas/aparelhos). */
  revision(): Promise<number>;
  /** Cria ou atualiza pelo id; devolve a visão como ficou gravada. */
  upsert(perfume: Perfume): Promise<Perfume>;
  /** Remove a entrada do dono; o produto sem nenhuma entrada sai do catálogo. */
  remove(id: string): Promise<boolean>;
  subscribe(listener: (revision: number) => void): () => void;

  me(): Promise<User>;
  /** Lança Error com mensagem para a pessoa quando o patch é inválido (ex.: username em uso). */
  updateMe(patch: OwnerPatch): Promise<User>;

  /** Perfil público de um username, com as listas abertas. Nulo quando não existe ou é privado. */
  publicProfile(username: string): Promise<{ user: User; lists: ListKind[] } | null>;
  /** Uma lista pública, como visões públicas (sem observações nem fontes internas). Nulo se privada. */
  publicList(username: string, list: ListKind): Promise<Perfume[] | null>;
  /** Referência de mídia que aparece em alguma lista pública. */
  isPublicMedia(ref: string): Promise<boolean>;
  /** Todas as referências de imagem em uso (a limpeza de mídia não toca nelas). */
  referenced(): Promise<Set<string>>;
  products(): Promise<readonly Product[]>;
}
