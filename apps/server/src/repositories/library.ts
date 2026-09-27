import type { ListKind, Privacy, Product, User } from '@perfumes/core/library';
import type { Perfume } from '@perfumes/core/perfume';

/**
 * Porta de persistência da biblioteca (usuários, produtos, entradas).
 *
 * Hoje há UMA implementação: `store` (store.ts), que guarda tudo em data/library.json — é a fonte de verdade
 * nesta etapa. A implementação Postgres (Neon + Drizzle, schema em db/schema.ts) entra na FASE 2 cumprindo este
 * mesmo contrato; as rotas não mudam. Por isso o contrato fala em visões `Perfume` (o que a API entrega hoje)
 * e já recebe o usuário implicitamente: com contas (FASE 6), cada método ganha `userId` vindo da sessão.
 *
 * Não existe implementação "de mentira" que finja ser banco: os testes usam a implementação real com uma pasta
 * de dados temporária.
 */

export type OwnerPatch = Partial<Pick<User, 'username' | 'displayName' | 'bio'>> & { privacy?: Partial<Privacy> };

export interface LibraryRepository {
  /** A coleção do dono, como a interface usa (visões), já ordenada. */
  list(): Perfume[];
  /** Número que muda a cada gravação (sincronização entre abas/aparelhos). */
  revision(): number;
  /** Cria ou atualiza pelo id; devolve a visão como ficou gravada. */
  upsert(perfume: Perfume): Perfume;
  /** Remove a entrada do dono; o produto sem nenhuma entrada sai do catálogo. */
  remove(id: string): Promise<boolean>;
  subscribe(listener: (revision: number) => void): () => void;

  me(): User;
  /** Lança Error com mensagem para a pessoa quando o patch é inválido (ex.: username em uso). */
  updateMe(patch: OwnerPatch): User;

  /** Perfil público de um username, com as listas abertas. Nulo quando não existe ou é privado. */
  publicProfile(username: string): { user: User; lists: ListKind[] } | null;
  /** Uma lista pública, como visões públicas (sem observações nem fontes internas). Nulo se privada. */
  publicList(username: string, list: ListKind): Perfume[] | null;
  /** Referência de mídia que aparece em alguma lista pública. */
  isPublicMedia(ref: string): boolean;
  /** Todas as referências de imagem em uso (a limpeza de mídia não toca nelas). */
  referenced(): Set<string>;
  products(): readonly Product[];
}
