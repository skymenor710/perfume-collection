import * as cheerio from 'cheerio';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { egress } from '../net/egress';
import { safeFetch } from '../net/safe-fetch';
import { config } from '../config';
import { event } from '../log';
import { acquireSource, pauseSource, reportSourceFailure, reportSourceSuccess, source, sourceAvailable, type SourceId } from '../sources/registry';
import { cached, DAY } from '../research/cache';

/**
 * Busca na internet, atrás de uma interface: o resto do sistema pede "resultados para esta consulta" e não sabe
 * quem responde. Provedores:
 *  - DuckDuckGo HTML (html.duckduckgo.com): sem chave; o robots.txt desse endereço permite leitura automática
 *    (os de Google, Bing e Brave proíbem a página de busca). Ritmo de 1 consulta a cada 5 s, cache de 7 dias,
 *    e pausa de 30 min se o site pedir verificação;
 *  - Brave Search API: se SEARCH_PROVIDER_KEY (ou BRAVE_SEARCH_API_KEY) estiver no .env.local, entra primeiro.
 * Pausas, ritmo e tempos limite vêm do registro de fontes (sources/registry.ts).
 * Trocar de provedor é mexer só aqui.
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  id: SourceId;
  name: string;
  available(): boolean;
  search(query: string): Promise<SearchResult[]>;
}

/** Resultados orgânicos da página HTML do DuckDuckGo (sem anúncios), já com o destino real de cada link. */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('.result').each((_, el) => {
    const a = $(el).find('a.result__a').first();
    let href = a.attr('href') ?? '';
    // Links vêm embrulhados em //duckduckgo.com/l/?uddg=<destino>; anúncios passam por y.js e ficam de fora.
    try {
      const wrapped = new URL(href, 'https://duckduckgo.com');
      const target = wrapped.searchParams.get('uddg');
      if (target) href = target;
    } catch {
      return;
    }
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js|ad_domain=/.test(href)) return;
    out.push({ url: href, title: a.text().trim(), snippet: $(el).find('.result__snippet').text().trim() });
  });
  return out.slice(0, 12);
}

export const duckDuckGo: SearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  available: () => sourceAvailable('duckduckgo'),
  async search(query) {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    url.searchParams.set('kl', 'fr-fr');
    if (!(await isAllowedByRobots(url))) return [];
    await waitTurn('html.duckduckgo.com');
    const d = source('duckduckgo');
    await new Promise((r) => setTimeout(r, d.rateLimit.extraDelayMs ?? 0));
    if (!acquireSource('duckduckgo')) return [];
    const res = await safeFetch(url.toString(), { timeoutMs: d.timeoutMs, maxBytes: 2 * 1024 * 1024, allowErrorStatus: true });
    if (res.status >= 400 || /anomaly-modal|captcha|unusual traffic/i.test(res.body)) {
      // Pediu verificação: pausa de 30 min, sem contornar.
      pauseSource('duckduckgo', 30 * 60_000, 'verificação anti-robô');
      return [];
    }
    const results = parseDuckDuckGoHtml(res.body);
    reportSourceSuccess('duckduckgo', { results: results.length });
    return results;
  },
};

export const braveApi: SearchProvider = {
  id: 'brave',
  name: 'Brave Search',
  available: () => sourceAvailable('brave'),
  async search(query) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '12');
    if (!acquireSource('brave')) return [];
    // Endereço fixo da API oficial (não vem de link de usuário), dentro do teto global de saída.
    const res = await egress.run(() =>
      fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': config.searchApiKey }, signal: AbortSignal.timeout(source('brave').timeoutMs) }),
    );
    if (!res.ok) {
      reportSourceFailure('brave', `http_${res.status}`);
      return [];
    }
    const data = (await res.json()) as { web?: { results?: { url: string; title: string; description?: string }[] } };
    reportSourceSuccess('brave', { results: data.web?.results?.length ?? 0 });
    return (data.web?.results ?? []).map((r) => ({ url: r.url, title: cheerio.load(`<i>${r.title}</i>`)('i').text(), snippet: cheerio.load(`<i>${r.description ?? ''}</i>`)('i').text() }));
  },
};

const PROVIDERS = [braveApi, duckDuckGo];

/** Primeiro provedor disponível que devolver algo. Resultado em cache por 7 dias. */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return [];
  for (const provider of PROVIDERS) {
    try {
      // Provedor pausado (pediu verificação) ou sem chave: não consulta a rede, mas o que já está em cache vale.
      const started = Date.now();
      const results = await cached(`search:${provider.name}:${q.toLowerCase()}`, 7 * DAY, () => (provider.available() ? provider.search(q) : Promise.resolve([])));
      event('search.completed', { provider: provider.id, durationMs: Date.now() - started, results: results.length });
      if (results.length) return results;
    } catch (error) {
      reportSourceFailure(provider.id, (error as { code?: string }).code ?? 'erro', { message: (error as Error).message });
    }
  }
  return [];
}
