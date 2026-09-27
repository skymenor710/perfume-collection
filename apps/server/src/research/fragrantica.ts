import * as cheerio from 'cheerio';
import { brandMatches, concentrationAdjust, nameSimilarity } from '@perfumes/core/match';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch } from '../net/safe-fetch';
import { cached, DAY } from './cache';

/**
 * Fragrantica, lido como um visitante: a página da marca (lista de perfumes) e a página do perfume.
 * A busca do site é proibida no robots.txt — por isso o caminho é marca → lista → perfume, nunca /search.
 * Tudo com cache (marca: 7 dias; perfume: 30 dias) e no ritmo de um pedido a cada 1,5 s.
 */

const BASE = 'https://www.fragrantica.com';

export interface FragranticaPerfume {
  url: string;
  name: string;
  brand: string;
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  notes: string[];
  mainAccords: string[];
  fragranceFamily: string | null;
  perfumer: string | null;
  releaseYear: number | null;
  gender: 'masculine' | 'feminine' | 'unisex' | null;
  image: string | null;
}

/** Se o site responde com desafio anti-robô, ele fica em pausa por 6 h: não se insiste, e não se contorna. */
let pausedUntil = 0;

async function get(url: string): Promise<string | null> {
  if (Date.now() < pausedUntil) return null;
  const u = new URL(url);
  if (!(await isAllowedByRobots(u))) return null;
  await waitTurn(u.host);
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 6 * 1024 * 1024, allowErrorStatus: true });
    if (/just a moment|cf-chl/i.test(res.body.slice(0, 4000))) {
      pausedUntil = Date.now() + 6 * 60 * 60_000;
      console.warn('[pesquisa] Fragrantica pediu verificação anti-robô; pausado por 6 h (usando outras fontes).');
      return null;
    }
    if (res.status >= 400) return null;
    return res.body;
  } catch {
    return null;
  }
}

const brandSlug = (brand: string) =>
  brand
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, 'and')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface ListedPerfume {
  url: string;
  title: string;
}

async function brandCatalog(brand: string): Promise<ListedPerfume[]> {
  const slug = brandSlug(brand);
  return cached(`fragrantica:designer:${slug}`, 7 * DAY, async () => {
    // A Fragrantica às vezes registra a marca como "Khadlaj-Perfumes", "Afnan-Perfumes"…
    let html: string | null = null;
    for (const s of [slug, `${slug}-Perfumes`]) {
      html = await get(`${BASE}/designers/${encodeURIComponent(s)}.html`);
      if (html) break;
    }
    if (!html) return [];
    const $ = cheerio.load(html);
    const seen = new Map<string, ListedPerfume>();
    $('a[href*="/perfume/"]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const m = /\/perfume\/[^/]+\/([^/]+)-(\d+)\.html$/.exec(href);
      if (!m) return;
      const url = new URL(href, BASE).toString();
      if (!seen.has(url)) seen.set(url, { url, title: m[1].replace(/-/g, ' ') });
    });
    return [...seen.values()];
  });
}

export function parsePerfumePage(html: string, url: string): FragranticaPerfume | null {
  const $ = cheerio.load(html);
  const layer = (name: string) =>
    $(`pyramid-level-new[notes="${name}"] a`)
      .map((_, a) => $(a).text().trim())
      .get()
      .filter(Boolean);
  const topNotes = layer('top');
  const heartNotes = layer('middle');
  const baseNotes = layer('base');
  // Perfumes sem pirâmide: a lista vem num único nível.
  const flat = topNotes.length || heartNotes.length || baseNotes.length ? [] : $('pyramid-level-new a').map((_, a) => $(a).text().trim()).get().filter(Boolean);

  const accordsHeading = $('h6').filter((_, h) => /main accords/i.test($(h).text())).first();
  const mainAccords = accordsHeading.length
    ? accordsHeading
        .parent()
        .find('span.truncate')
        .map((_, s) => $(s).text().trim())
        .get()
        .filter(Boolean)
    : [];

  const description = $('meta[name="description"]').attr('content') ?? '';
  const family = /is an? (.+?) fragrance for/i.exec(description)?.[1] ?? null;
  const year = Number(/launched in (\d{4})/i.exec(description)?.[1] ?? /(\d{4})\s*$/.exec($('title').text())?.[1] ?? NaN);
  const title = $('title').text();
  const gender = /for women and men/i.test(title) ? 'unisex' : /for women/i.test(title) ? 'feminine' : /for men/i.test(title) ? 'masculine' : null;

  const perfumers = $('a[href*="/noses/"]')
    .map((_, a) => $(a).text().trim())
    .get()
    .filter((t) => t && !/^perfumers?$/i.test(t));

  const m = /\/perfume\/([^/]+)\/([^/]+)-(\d+)\.html/.exec(url);
  if (!m) return null;
  const hasAny = topNotes.length + heartNotes.length + baseNotes.length + flat.length + mainAccords.length > 0;
  if (!hasAny) return null;
  return {
    url,
    brand: decodeURIComponent(m[1]).replace(/-/g, ' '),
    name: decodeURIComponent(m[2]).replace(/-/g, ' '),
    topNotes,
    heartNotes,
    baseNotes,
    notes: flat,
    mainAccords,
    fragranceFamily: family,
    perfumer: perfumers.length ? [...new Set(perfumers)].slice(0, 3).join(', ') : null,
    releaseYear: Number.isFinite(year) ? year : null,
    gender,
    image: `https://fimgs.net/mdimg/perfume/o.${m[3]}.jpg`,
  };
}

/** Acha o perfume na lista da marca pelo nome; devolve nulo se nada for parecido o bastante. */
export async function findOnFragrantica(brand: string, name: string, hints: string[] = []): Promise<FragranticaPerfume | null> {
  const list = await brandCatalog(brand);
  if (!list.length) return null;
  const wanted = [name, ...hints].filter(Boolean);
  const ranked = list
    .map((p) => ({ p, score: Math.max(...wanted.map((w) => nameSimilarity(w, p.title, brand))) + concentrationAdjust(p.title, hints[0]) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.72) return null;
  // Empate entre concentrações (EDP × Extrait) sem pista: melhor não escolher errado.
  if (ranked[1] && ranked[1].score >= best.score - 0.001 && ranked[1].p.title !== best.p.title) {
    const concentration = hints.join(' ').toLowerCase();
    const pick = ranked.slice(0, 3).find((r) => r.score >= best.score - 0.001 && /extrait|elixir|intense|parfum/i.test(r.p.title) === /extrait|elixir|intense/.test(concentration));
    if (!pick) return null;
    ranked[0] = pick;
  }
  const chosen = ranked[0].p;
  return cached(`fragrantica:perfume:${chosen.url}`, 30 * DAY, async () => {
    const html = await get(chosen.url);
    const parsed = html ? parsePerfumePage(html, chosen.url) : null;
    if (parsed && !brandMatches(brand, parsed.brand)) return null;
    return parsed;
  });
}
