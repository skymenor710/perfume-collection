/**
 * Vagas de pesquisa pesada (baixar fotos, recorte por IA): no máximo duas ao mesmo tempo no processo, somando
 * as rotas antigas (que recusam com 429 quando lotado) e os jobs da API v1 (que esperam na fila).
 */
export class Slots {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get inUse() {
    return this.active;
  }

  get waiting() {
    return this.queue.length;
  }

  private release = () => {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  };

  private grant(): () => void {
    this.active++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.release();
    };
  }

  /** Vaga agora ou nulo (para quem prefere recusar a esperar). */
  tryAcquire(): (() => void) | null {
    return this.active < this.max && this.queue.length === 0 ? this.grant() : null;
  }

  /** Espera a vez. Rejeita se o sinal for abortado antes. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    const now = this.tryAcquire();
    if (now) return Promise.resolve(now);
    return new Promise((resolve, reject) => {
      const turn = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(this.grant());
      };
      const onAbort = () => {
        this.queue = this.queue.filter((t) => t !== turn);
        reject(new Error('cancelado na fila'));
      };
      if (signal?.aborted) return reject(new Error('cancelado na fila'));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(turn);
    });
  }
}

export const researchSlots = new Slots(2);
