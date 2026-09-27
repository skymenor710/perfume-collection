import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { importFromUrl, ImportCancelledError, type ImportOutcome, type ImportStage } from '../import/pipeline';
import { researchSlots, type Slots } from './slots';
import { STAGE_PERCENT, type ImportJob, type ImportJobInput, type ImportJobStore } from './types';

export type ImportExecutor = (input: ImportJobInput, onStage: (stage: ImportStage) => void, context: { jobId: string; signal: AbortSignal }) => Promise<ImportOutcome>;

/** O motor de verdade: o mesmo resolvedor das rotas antigas. */
export const defaultExecutor: ImportExecutor = (input, onStage, { jobId, signal }) =>
  importFromUrl(input.url, input.identity, onStage, input.variantId, { jobId, signal, via: 'job' });

const MESSAGES = {
  internal: 'Algo deu errado aqui. Tente de novo.',
  cancelled: 'Importação cancelada.',
} as const;

const RETRYABLE: readonly ImportJob['status'][] = ['failed', 'cancelled', 'waiting_choice'];

/**
 * Executa jobs de importação: fila (divide as duas vagas de pesquisa com as rotas antigas), progresso por etapa,
 * cancelamento cooperativo, nova tentativa e deduplicação. Cada mudança de estado é gravada no `ImportJobStore`
 * e avisada a quem acompanha (`subscribe`).
 */
export class ImportJobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly live = new Map<string, ImportJob>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly running = new Set<Promise<void>>();
  private readonly events = new EventEmitter();

  constructor(
    private readonly store: ImportJobStore,
    private readonly execute: ImportExecutor = defaultExecutor,
    private readonly slots: Slots = researchSlots,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(0);
  }

  /** Cria (ou reaproveita um job igual ainda ativo) e já põe na fila. */
  async create(ownerId: string, input: ImportJobInput): Promise<{ job: ImportJob; deduplicated: boolean }> {
    const existing = await this.store.findActive(ownerId, input);
    if (existing) return { job: this.live.get(existing.id) ?? existing, deduplicated: true };
    const at = this.now().toISOString();
    const job: ImportJob = {
      id: `imp_${randomUUID()}`,
      ownerId,
      status: 'queued',
      input,
      progress: { stage: null, percent: 0 },
      result: null,
      error: null,
      attempts: 0,
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      finishedAt: null,
    };
    await this.store.create(job);
    this.live.set(job.id, job);
    this.start(job.id);
    return { job: structuredClone(job), deduplicated: false };
  }

  /** O job, só se for do dono (de outro dono = não existe, sem revelar). */
  async get(ownerId: string, id: string): Promise<ImportJob | null> {
    const job = this.live.get(id) ?? (await this.store.get(id));
    return job && job.ownerId === ownerId ? structuredClone(job) : null;
  }

  list(ownerId: string, limit?: number) {
    return this.store.listByOwner(ownerId, limit);
  }

  async cancel(ownerId: string, id: string): Promise<ImportJob | null> {
    const job = await this.get(ownerId, id);
    if (!job) return null;
    if (job.status !== 'queued' && job.status !== 'running') return job;
    this.controllers.get(id)?.abort();
    return this.update(id, { status: 'cancelled', error: { code: 'cancelled', message: MESSAGES.cancelled }, finishedAt: this.now().toISOString() });
  }

  /** Nova tentativa de um job que terminou sem sucesso (ou que espera a escolha de versão: aí com `variantId`). */
  async retry(ownerId: string, id: string, patch: { variantId?: string | null } = {}): Promise<ImportJob | 'not_retryable' | null> {
    const job = await this.get(ownerId, id);
    if (!job) return null;
    if (!RETRYABLE.includes(job.status)) return 'not_retryable';
    const next = await this.update(id, {
      status: 'queued',
      input: { ...job.input, variantId: patch.variantId !== undefined ? patch.variantId : job.input.variantId },
      progress: { stage: null, percent: 0 },
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    this.start(id);
    return next;
  }

  /** Avisos de mudança de um job (para o fluxo SSE). Devolve a função que para de ouvir. */
  subscribe(id: string, listener: (job: ImportJob) => void): () => void {
    this.events.on(id, listener);
    return () => this.events.off(id, listener);
  }

  /** Espera todos os jobs em andamento terminarem (testes e desligamento). */
  async idle() {
    while (this.running.size) await Promise.allSettled([...this.running]);
    await Promise.allSettled([...this.writes.values()]);
  }

  private start(id: string) {
    const task = this.run(id).finally(() => this.running.delete(task));
    this.running.add(task);
  }

  private async update(id: string, patch: Partial<ImportJob>): Promise<ImportJob> {
    const current = this.live.get(id) ?? (await this.store.get(id));
    if (!current) throw new Error(`job ${id} sumiu`);
    const next: ImportJob = { ...current, ...patch, updatedAt: this.now().toISOString() };
    this.live.set(id, next);
    // Gravações de um mesmo job em ordem (importa para um banco de verdade).
    const copy = structuredClone(next);
    const write = (this.writes.get(id) ?? Promise.resolve()).then(() => this.store.save(copy)).catch(() => {});
    this.writes.set(id, write);
    this.events.emit(id, structuredClone(next));
    if (next.status !== 'queued' && next.status !== 'running') {
      // Terminou: a cópia viva sai da memória depois da última gravação.
      void write.then(() => {
        if (this.live.get(id) === next) this.live.delete(id);
      });
    }
    return structuredClone(next);
  }

  private isCancelled(id: string) {
    return this.live.get(id)?.status === 'cancelled';
  }

  private async run(id: string) {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let release: (() => void) | null = null;
    try {
      try {
        release = await this.slots.acquire(controller.signal);
      } catch {
        return; // cancelado enquanto esperava a vez (o estado já foi gravado por cancel)
      }
      if (this.isCancelled(id)) return;
      const job = this.live.get(id) ?? (await this.store.get(id));
      if (!job) return;
      await this.update(id, { status: 'running', startedAt: this.now().toISOString(), attempts: job.attempts + 1 });
      const outcome = await this.execute(
        job.input,
        (stage) => {
          if (!this.isCancelled(id)) void this.update(id, { progress: { stage, percent: STAGE_PERCENT[stage] } });
        },
        { jobId: id, signal: controller.signal },
      );
      if (this.isCancelled(id)) return;
      const finishedAt = this.now().toISOString();
      if (outcome.ok === true) await this.update(id, { status: 'succeeded', result: outcome, progress: { stage: 'done', percent: 100 }, finishedAt });
      else if (outcome.ok === 'choose') await this.update(id, { status: 'waiting_choice', result: outcome, finishedAt });
      else await this.update(id, { status: 'failed', result: outcome, error: { code: outcome.code, message: outcome.message }, finishedAt });
    } catch (error) {
      if (this.isCancelled(id)) return;
      const cancelled = error instanceof ImportCancelledError;
      await this.update(id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? { code: 'cancelled', message: MESSAGES.cancelled } : { code: 'internal', message: MESSAGES.internal },
        finishedAt: this.now().toISOString(),
      });
    } finally {
      release?.();
      this.controllers.delete(id);
    }
  }
}
