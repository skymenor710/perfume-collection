import { config } from '../config';
import { event } from '../log';

/**
 * Teto GLOBAL de saída para a internet, somando todas as fontes (lojas, catálogo, busca, fotos, modelo de IA).
 *
 * O ritmo por site (`polite.ts`, 1,5 s por host) protege cada loja; este limite protege o conjunto: mesmo com
 * vários perfumes pesquisando ao mesmo tempo, o servidor nunca vira um robô agressivo nem estoura a banda.
 * Duas regras: no máximo N conexões simultâneas e no máximo M pedidos por minuto (janela deslizante).
 * Quem passa do limite ESPERA a vez (dentro do próprio tempo limite do pedido) — não é recusado de cara.
 */

export class EgressAbortedError extends Error {
  constructor() {
    super('Pedido cancelado enquanto esperava a vez');
  }
}

export class EgressLimiter {
  private active = 0;
  private stamps: number[] = [];
  private waiters = new Set<() => void>();
  private lastThrottleLog = 0;

  constructor(
    private readonly limits: () => { maxConcurrent: number; maxPerMinute: number },
    private readonly now: () => number = Date.now,
  ) {}

  get stats() {
    this.prune(this.now());
    return { active: this.active, lastMinute: this.stamps.length, waiting: this.waiters.size };
  }

  private prune(now: number) {
    while (this.stamps.length && now - (this.stamps[0] ?? 0) >= 60_000) this.stamps.shift();
  }

  private wake() {
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const w of waiting) w();
  }

  /** Espera a vez e devolve a função que libera a vaga (chamar sempre, em finally). */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal?.aborted) throw new EgressAbortedError();
      const { maxConcurrent, maxPerMinute } = this.limits();
      const now = this.now();
      this.prune(now);
      if (this.active < maxConcurrent && this.stamps.length < maxPerMinute) {
        this.active++;
        this.stamps.push(now);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.active--;
          this.wake();
        };
      }
      if (now - this.lastThrottleLog > 10_000) {
        this.lastThrottleLog = now;
        event('egress.throttled', { active: this.active, lastMinute: this.stamps.length, maxConcurrent, maxPerMinute }, 'warn');
      }
      const minuteFull = this.stamps.length >= maxPerMinute;
      const waitMs = minuteFull ? Math.max(5, (this.stamps[0] ?? now) + 60_000 - now) : null;
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = () => {
          if (timer) clearTimeout(timer);
          this.waiters.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        if (waitMs !== null) timer = setTimeout(done, waitMs);
        this.waiters.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }

  /** Roda `task` dentro de uma vaga. */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }
}

/** O limitador do processo (valores do .env: EGRESS_MAX_CONCURRENT, EGRESS_MAX_PER_MINUTE). */
export const egress = new EgressLimiter(() => config.egress);
