/**
 * Disjuntor por fonte: depois de N falhas seguidas a fonte "abre" (ninguém a consulta) por um tempo; passado o tempo,
 * UM pedido de teste decide se ela volta (fecha) ou abre de novo. Também aceita pausa explícita (`trip`) — é o que
 * acontece quando um site pede verificação anti-robô: não se insiste e não se contorna, espera-se.
 *
 * Estado só em memória, por processo. Em produção com vários processos, cada um aprende sozinho (aceitável: o pior
 * caso é cada processo fazer um pedido de teste).
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Falhas seguidas até abrir. `null` = nunca abre por falha (só por pausa explícita). */
  failureThreshold: number | null;
  /** Quanto tempo fica aberto depois de atingir o limite de falhas. */
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private reason: string | null = null;
  private readonly now: () => number;

  constructor(private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.openUntil === 0) return 'closed';
    return this.now() < this.openUntil ? 'open' : 'half-open';
  }

  get snapshot() {
    const state = this.state;
    return { state, failures: this.failures, openUntil: state === 'closed' ? null : new Date(this.openUntil).toISOString(), reason: this.reason };
  }

  /** Pode consultar agora? Em meia-abertura, só um pedido de teste por vez. */
  canRequest(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  /** Só consulta o estado, sem reservar o pedido de teste (para listar e para decidir usar cache). */
  isAvailable(): boolean {
    const state = this.state;
    return state === 'closed' || (state === 'half-open' && !this.probing);
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
    this.probing = false;
    this.reason = null;
  }

  recordFailure(reason = 'falha') {
    this.probing = false;
    this.failures++;
    const threshold = this.options.failureThreshold;
    if (this.state === 'half-open' || (threshold !== null && this.failures >= threshold)) this.open(this.options.cooldownMs, reason);
  }

  /** Pausa explícita (ex.: o site pediu verificação). */
  trip(ms: number, reason: string) {
    this.probing = false;
    this.open(ms, reason);
  }

  private open(ms: number, reason: string) {
    this.openUntil = this.now() + ms;
    this.reason = reason;
  }
}
