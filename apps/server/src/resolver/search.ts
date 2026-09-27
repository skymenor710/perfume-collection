import * as cheerio from 'cheerio';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch } from '../net/safe-fetch';
import { cached, DAY } from '../research/cache';

/**
 * Busca na internet, atrás de uma interface: o resto do sistema pede "resultados para esta consulta" e não sabe
 * quem responde. Provedores:
 *  - DuckDuckGo HTML (html.duckduckgo.com): sem chave; o robots.txt desse endereço permite leitura automática
 *    (os de Google, Bing e Brave proíbem a página de busca). Ritmo de 1 consulta a cada 5 s, cache de 7 dias,
 *    e pausa de 30 min se o site pedir verificação;
 *  - Brave Search API: se BRAVE_SEARCH_API_KEY estiver no .env.local (plano gratuito da Brave), entra primeiro.
 * Trocar de provedor é mexer só aqui.
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  name: string;
  available(): boolean;
  search(query: string): Promise<SearchResult[]>;
}

let ddgPausedUntil = 0;

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
  name: 'DuckDuckGo',
  available: () => Date.now() > ddgPausedUntil,
  async search(query) {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    url.searchParams.set('kl', 'fr-fr');
    if (!(await isAllowedByRobots(url))) return [];
    await waitTurn('html.duckduckgo.com');
    await new Promise((r) => setTimeout(r, 3500));
    const res = await safeFetch(url.toString(), { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024, allowErrorStatus: true });
    if (res.status >= 400 || /anomaly-modal|captcha|unusual traffic/i.test(res.body)) {
      ddgPausedUntil = Date.now() + 30 * 60_000;
      console.warn('[busca] DuckDuckGo pediu verificação; busca pausada por 30 min (sem contornar).');
      return [];
    }
    return parseDuckDuckGoHtml(res.body);
  },
};

export const braveApi: SearchProvider = {
  name: 'Brave Search',
  available: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  async search(query) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '12');
    const res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY ?? '' } });
    if (!res.ok) return [];
    const data = (await res.json()) as { web?: { results?: { url: string; title: string; description?: string }[] } };
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
      const results = await cached(`search:${provider.name}:${q.toLowerCase()}`, 7 * DAY, () => (provider.available() ? provider.search(q) : Promise.resolve([])));
      if (results.length) return results;
    } catch (error) {
      console.warn(`[busca] ${provider.name}: ${(error as Error).message}`);
    }
  }
  return [];
}
