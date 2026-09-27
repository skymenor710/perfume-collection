import { TERMINAL, sameInput, type ImportJob, type ImportJobInput, type ImportJobStore } from './types';

/**
 * Jobs em memória — NÃO PERSISTENTE, e é de propósito: reiniciar o servidor esquece os jobs (a biblioteca não
 * é afetada; um job só pesquisa, quem grava o perfume é o cliente). É a implementação desta etapa, sem banco;
 * a tabela import_jobs do Postgres (db/schema.ts) substitui esta classe na FASE 2 pelo mesmo contrato.
 *
 * Limpeza: jobs terminados somem depois de `ttlMs` e nunca passam de `maxJobs` no total.
 */
export class MemoryImportJobStore implements ImportJobStore {
  readonly persistent = false;
  private jobs = new Map<string, ImportJob>();

  constructor(
    private readonly ttlMs = 60 * 60_000,
    private readonly maxJobs = 500,
    private readonly now: () => number = Date.now,
  ) {}

  private sweep() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (TERMINAL.includes(job.status) && job.finishedAt && Date.parse(job.finishedAt) < cutoff) this.jobs.delete(id);
    }
    if (this.jobs.size <= this.maxJobs) return;
    const finished = [...this.jobs.values()].filter((j) => TERMINAL.includes(j.status)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const job of finished) {
      if (this.jobs.size <= this.maxJobs) break;
      this.jobs.delete(job.id);
    }
  }

  async create(job: ImportJob) {
    this.sweep();
    this.jobs.set(job.id, structuredClone(job));
  }

  async get(id: string) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  async save(job: ImportJob) {
    this.jobs.set(job.id, structuredClone(job));
  }

  async listByOwner(ownerId: string, limit = 50) {
    this.sweep();
    return [...this.jobs.values()]
      .filter((j) => j.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }

  async findActive(ownerId: string, input: ImportJobInput) {
    for (const job of this.jobs.values()) {
      if (job.ownerId === ownerId && (job.status === 'queued' || job.status === 'running') && sameInput(job.input, input)) return structuredClone(job);
    }
    return null;
  }
}
