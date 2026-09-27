import type { ImportOutcome, ImportStage } from '../import/pipeline';
import type { Identity } from '../resolver/resolve';

/**
 * Importação como JOB: o cliente cria (POST /api/v1/imports), recebe o id na hora e acompanha o progresso
 * (GET /api/v1/imports/:id ou o fluxo /events). O trabalho não depende da conexão ficar aberta.
 *
 * Estados:
 *   queued → running → succeeded | failed | cancelled | waiting_choice
 *   waiting_choice: a loja vende mais de um tamanho; o job para e espera a escolha (retry com variantId).
 *   failed/cancelled/waiting_choice → queued de novo por retry.
 */

export type ImportJobStatus = 'queued' | 'running' | 'waiting_choice' | 'succeeded' | 'failed' | 'cancelled';

export const TERMINAL: readonly ImportJobStatus[] = ['succeeded', 'failed', 'cancelled', 'waiting_choice'];

export interface ImportJobInput {
  url: string;
  identity: Partial<Identity> | null;
  variantId: string | null;
}

export interface ImportJobError {
  /** Código estável para o cliente decidir o que mostrar. */
  code: 'invalid_url' | 'unidentified' | 'internal' | 'cancelled';
  /** Frase para a pessoa (nunca erro técnico cru). */
  message: string;
}

export interface ImportJob {
  id: string;
  /** Dono do job (hoje o único usuário; com contas, o da sessão). */
  ownerId: string;
  status: ImportJobStatus;
  input: ImportJobInput;
  progress: { stage: ImportStage | null; percent: number };
  /** Resultado do resolvedor quando termina (ok true ou 'choose'); nulo antes disso. */
  result: ImportOutcome | null;
  error: ImportJobError | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Onde os jobs vivem. Contrato pensado para a tabela `import_jobs` do Postgres (db/schema.ts) na FASE 2;
 * hoje só existe a implementação em memória (declaradamente não persistente).
 */
export interface ImportJobStore {
  create(job: ImportJob): Promise<void>;
  get(id: string): Promise<ImportJob | null>;
  /** Grava o job inteiro (quem chama sempre parte do estado mais recente). */
  save(job: ImportJob): Promise<void>;
  listByOwner(ownerId: string, limit?: number): Promise<ImportJob[]>;
  /** Job ainda ativo (queued/running) do mesmo dono para a mesma entrada — evita trabalho duplicado. */
  findActive(ownerId: string, input: ImportJobInput): Promise<ImportJob | null>;
}

/** Percentual aproximado por etapa do resolvedor (para barra de progresso; as etapas nem sempre passam todas). */
export const STAGE_PERCENT: Record<ImportStage, number> = {
  link: 5,
  identity: 15,
  fallback: 20,
  search: 30,
  compare: 45,
  images: 60,
  bottle: 75,
  notes: 90,
  final: 95,
  done: 100,
};

export function sameInput(a: ImportJobInput, b: ImportJobInput): boolean {
  return a.url.trim() === b.url.trim() && (a.variantId ?? null) === (b.variantId ?? null) && JSON.stringify(a.identity ?? null) === JSON.stringify(b.identity ?? null);
}
