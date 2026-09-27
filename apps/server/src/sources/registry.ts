import { config } from '../config';
import { event } from '../log';
import { CircuitBreaker } from './circuit-breaker';

/**
 * Registro das fontes de dados. Descreve o motor ATUAL (nenhuma fonte nova): quem é cada fonte, que papel tem,
 * em que ordem entra, quanto espera, com que ritmo, quanto tempo o resultado vale em cache, quão confiável é e
 * se está ligada. O resolvedor continua decidindo a estratégia; o registro dá a ele (e aos logs, e à API) uma
 * linguagem comum e um disjuntor por fonte.
 */

export type SourceKind = 'catalog' | 'productPage' | 'officialStore' | 'perfumeDatabase' | 'searchAPI' | 'reseller';

export type SourceId = 'product-page' | 'parfumo' | 'official-stores' | 'fragrantica' | 'brave' | 'duckduckgo' | 'resellers';

export interface SourceDescriptor {
  id: SourceId;
  name: string;
  kind: SourceKind;
  /** Menor = consultada antes dentro do mesmo papel. */
  priority: number;
  timeoutMs: number;
  rateLimit: {
    /** Intervalo mínimo entre pedidos ao mesmo site (polite.ts). */
    perHostMs: number;
    /** Espera extra desta fonte, além do intervalo por site. */
    extraDelayMs?: number;
  };
  /** Validade do resultado em cache (0 = não guarda). */
  cacheTtlMs: number;
  /** Confiança dos dados desta fonte, 0–1 (usada para explicar a origem de cada campo). */
  quality: number;
  /** Ligada por padrão (SOURCES_DISABLED no .env desliga). */
  enabled: boolean;
  breaker: { failureThreshold: number | null; cooldownMs: number };
  /** Condição extra de disponibilidade (ex.: chave de API presente). */
  requires?: () => boolean;
  notes: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const POLITE = 1500;

export const SOURCES: readonly SourceDescriptor[] = [
  {
    id: 'product-page',
    name: 'Página do link',
    kind: 'productPage',
    priority: 1,
    timeoutMs: 15_000,
    rateLimit: { perHostMs: POLITE },
    cacheTtlMs: 0,
    quality: 0.9,
    enabled: true,
    // Cada link é um site diferente: falha de um não diz nada sobre o próximo.
    breaker: { failureThreshold: null, cooldownMs: 0 },
    notes: 'A loja do link colado (HTML, JSON-LD, Shopify .js, WooCommerce). Só uma pista: a identidade é conferida.',
  },
  {
    id: 'parfumo',
    name: 'Parfumo',
    kind: 'catalog',
    priority: 2,
    timeoutMs: 15_000,
    rateLimit: { perHostMs: POLITE },
    cacheTtlMs: 7 * DAY,
    quality: 0.8,
    enabled: true,
    breaker: { failureThreshold: 5, cooldownMs: 30 * MIN },
    notes: 'Catálogo por marca (robots permite /Perfumes/). Identidade sem buscador; lista 7 dias, perfume 30 dias.',
  },
  {
    id: 'official-stores',
    name: 'Lojas oficiais',
    kind: 'officialStore',
    priority: 3,
    timeoutMs: 15_000,
    rateLimit: { perHostMs: POLITE },
    cacheTtlMs: DAY,
    quality: 0.95,
    enabled: true,
    breaker: { failureThreshold: null, cooldownMs: 0 },
    notes: 'Shopify /products.json das marcas (registro em research/stores.ts). Melhores fotos e notas.',
  },
  {
    id: 'fragrantica',
    name: 'Fragrantica',
    kind: 'perfumeDatabase',
    priority: 4,
    timeoutMs: 15_000,
    rateLimit: { perHostMs: POLITE },
    cacheTtlMs: 30 * DAY,
    quality: 0.9,
    enabled: true,
    breaker: { failureThreshold: 3, cooldownMs: 6 * HOUR },
    notes: 'Bloqueia leitura automática (Cloudflare) na prática: pausa de 6 h quando pede verificação. Sem contornar.',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    kind: 'searchAPI',
    priority: 5,
    timeoutMs: 10_000,
    rateLimit: { perHostMs: 1000 },
    cacheTtlMs: 7 * DAY,
    quality: 0.7,
    enabled: true,
    breaker: { failureThreshold: 3, cooldownMs: 15 * MIN },
    requires: () => Boolean(config.searchApiKey),
    notes: 'API oficial (plano gratuito). Só com SEARCH_PROVIDER_KEY.',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    kind: 'searchAPI',
    priority: 6,
    timeoutMs: 12_000,
    rateLimit: { perHostMs: POLITE, extraDelayMs: 3500 },
    cacheTtlMs: 7 * DAY,
    quality: 0.6,
    enabled: true,
    breaker: { failureThreshold: 3, cooldownMs: 30 * MIN },
    notes: 'html.duckduckgo.com (robots permite). Pede verificação depois de ~10 buscas seguidas: pausa 30 min.',
  },
  {
    id: 'resellers',
    name: 'Revendedores',
    kind: 'reseller',
    priority: 7,
    timeoutMs: 15_000,
    rateLimit: { perHostMs: POLITE },
    cacheTtlMs: 0,
    quality: 0.6,
    enabled: true,
    breaker: { failureThreshold: null, cooldownMs: 0 },
    notes: 'Páginas e fotos de lojas vindas da busca. Só entram se passarem no controle de qualidade.',
  },
];

const breakers = new Map<SourceId, CircuitBreaker>();
const runtimeDisabled = new Set<SourceId>();

export function source(id: SourceId): SourceDescriptor {
  const found = SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`Fonte desconhecida: ${id}`);
  return found;
}

export function sourceBreaker(id: SourceId): CircuitBreaker {
  let b = breakers.get(id);
  if (!b) {
    b = new CircuitBreaker(source(id).breaker);
    breakers.set(id, b);
  }
  return b;
}

function disabledByConfig(id: SourceId): boolean {
  return config.sourcesDisabled.includes(id);
}

export function sourceEnabled(id: SourceId): boolean {
  const s = source(id);
  return s.enabled && !runtimeDisabled.has(id) && !disabledByConfig(id) && (s.requires?.() ?? true);
}

/** Ligada, com os requisitos atendidos e com o disjuntor fechado (ou liberando o pedido de teste). */
export function sourceAvailable(id: SourceId): boolean {
  return sourceEnabled(id) && sourceBreaker(id).isAvailable();
}

/** Reserva o pedido (conta o pedido de teste em meia-abertura). Usar logo antes de ir à rede. */
export function acquireSource(id: SourceId): boolean {
  return sourceEnabled(id) && sourceBreaker(id).canRequest();
}

export function reportSourceSuccess(id: SourceId, fields: Record<string, unknown> = {}) {
  sourceBreaker(id).recordSuccess();
  event('source.used', { source: id, ...fields });
}

export function reportSourceFailure(id: SourceId, code: string, fields: Record<string, unknown> = {}) {
  sourceBreaker(id).recordFailure(code);
  event('source.error', { source: id, code, state: sourceBreaker(id).state, ...fields }, 'warn');
}

/** Pausa explícita — o site pediu verificação. Não se contorna. */
export function pauseSource(id: SourceId, ms: number, reason: string) {
  sourceBreaker(id).trip(ms, reason);
  event('source.paused', { source: id, reason, minutes: Math.round(ms / MIN) }, 'warn');
}

export function setSourceEnabled(id: SourceId, enabled: boolean) {
  if (enabled) runtimeDisabled.delete(id);
  else runtimeDisabled.add(id);
}

/** Retrato das fontes (para GET /api/v1/sources e para diagnóstico). Sem chaves, sem URLs internas. */
export function sourcesStatus() {
  return [...SOURCES]
    .sort((a, b) => a.priority - b.priority)
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      priority: s.priority,
      timeoutMs: s.timeoutMs,
      cacheTtlMs: s.cacheTtlMs,
      quality: s.quality,
      enabled: sourceEnabled(s.id),
      available: sourceAvailable(s.id),
      breaker: sourceBreaker(s.id).snapshot,
    }));
}

/** Só para testes: volta tudo ao estado inicial. */
export function __resetSources() {
  breakers.clear();
  runtimeDisabled.clear();
}
