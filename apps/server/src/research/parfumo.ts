import * as cheerio from 'cheerio';
import { brandMatches, concentrationAdjust, nameSimilarity } from '@perfumes/core/match';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch } from '../net/safe-fetch';
import { cached, DAY } from './cache';
import type { FragranticaPerfume } from './fragrantica';

/**
 * Parfumo (parfumo.com), lido como visitante: página da marca (lista paginada) → página do perfume.
 * O robots.txt proíbe a busca (s_perfumes*) e permite /Perfumes/; o site declara "ai-input=yes".
 * Mesmo formato de resultado do Fragrantica, para o resto da pesquisa não precisar saber a fonte.
 */

const BASE = 'https://www.parfumo.com';

async function get(url: string): Promise<{ body: string; url: string } | null> {
  const u = new URL(url);
  if (!(await isAllowedByRobots(u))) return null;
  await waitTurn(u.host);
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 8 * 1024 * 1024, allowErrorStatus: true });
    if (res.status >= 400 || /\/404$/.test(new URL(res.url).pathname) || /just a moment/i.test(res.body.slice(0, 3000))) return null;
    return { body: res.body, url: res.url };
  } catch {
    return null;
  }
}

/** "Afnan" → Afnan, Afnan_Perfumes… (a Parfumo usa o nome registrado da marca, com sublinhados). */
function brandSlugs(brand: string): string[] {
  const clean = brand.replace(/[×x]\s*RRQ/i, '').trim();
  const words = clean.normalize('NFD').replace(/\p{M}/gu, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const under = title.join('_');
  const lower = words.join('-').toLowerCase();
  return [...new Set([under, `${under}_Perfumes`, lower, `${under}_Parfums`, `${under}_Fragrances`])];
}

interface Listed {
  url: string;
  title: string;
}

async function brandCatalog(brand: string): Promise<{ slug: string; items: Listed[] } | null> {
  return cached(`parfumo:brand:${brand.toLowerCase()}`, 7 * DAY, async () => {
    for (const slug of brandSlugs(brand)) {
      const first = await get(`${BASE}/Perfumes/${slug}`);
      if (!first) continue;
      const items = new Map<string, Listed>();
      const collect = (html: string) => {
        const $ = cheerio.load(html);
        $('a[href]').each((_, a) => {
          const href = $(a).attr('href') ?? '';
          const m = new RegExp(`^(?:${BASE})?/Perfumes/${slug}/([^/?#]+)$`, 'i').exec(href);
          if (!m) return;
          const url = new URL(href, BASE).toString();
          const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim() || m[1].replace(/[-_]/g, ' ');
          if (!items.has(url) || items.get(url)!.title.length < title.length) items.set(url, { url, title: title.length > 80 ? m[1].replace(/[-_]/g, ' ') : title });
        });
      };
      collect(first.body);
      for (let page = 2; page <= 8; page++) {
        const before = items.size;
        const next = await get(`${BASE}/Perfumes/${slug}?current_page=${page}`);
        if (!next) break;
        collect(next.body);
        if (items.size === before) break;
      }
      if (items.size) return { slug, items: [...items.values()] };
    }
    return null;
  });
}

export function parseParfumoPage(html: string, url: string, brand: string): FragranticaPerfume | null {
  const $ = cheerio.load(html);
  const layer = (cls: string) =>
    $(`.pyramid_block.${cls} .clickable_note_img`)
      .map((_, e) => $(e).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
  const topNotes = layer('nb_t');
  const heartNotes = layer('nb_m');
  const baseNotes = layer('nb_b');
  const flat = topNotes.length || heartNotes.length || baseNotes.length ? [] : $('.notes_list .clickable_note_img').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const accordsHeading = $('h2').filter((_, h) => /main accords/i.test($(h).text())).first();
  const mainAccords = accordsHeading.length
    ? accordsHeading
        .parent()
        .find('.s-circle-container .text-xs')
        .map((_, e) => $(e).text().trim())
        .get()
        .filter(Boolean)
    : [];
  const perfumers = $('a[href*="/Perfumers/"]')
    .map((_, a) => $(a).text().trim())
    .get()
    .filter((t) => t && !/^perfumers?$/i.test(t));
  const year = Number($('a[href*="/Release_Years/"]').map((_, a) => $(a).text().trim()).get().find((t) => /^\d{4}$/.test(t)) ?? NaN);
  const meta = `${$('meta[name="description"]').attr('content') ?? ''} ${$('title').text()}`;
  const gender = /women and men|unisex/i.test(meta) ? 'unisex' : /for women/i.test(meta) ? 'feminine' : /for men/i.test(meta) ? 'masculine' : null;
  const image = (html.match(/https:\/\/media\.parfumo\.com\/perfumes\/[a-z0-9]{2}\/[^"'\s?]+_1200\.jpg/i) ?? [])[0] ?? null;
  const h1 = $('h1').first().clone();
  h1.find('span, a, small').remove();
  const name = h1.text().replace(/\s+/g, ' ').trim() || decodeURIComponent(url.split('/').pop() ?? '').replace(/[-_]/g, ' ');
  if (topNotes.length + heartNotes.length + baseNotes.length + flat.length + mainAccords.length === 0) return null;
  return {
    url,
    name,
    brand,
    topNotes,
    heartNotes,
    baseNotes,
    notes: flat,
    mainAccords,
    fragranceFamily: null,
    perfumer: perfumers.length ? [...new Set(perfumers)].slice(0, 3).join(', ') : null,
    releaseYear: Number.isFinite(year) ? year : null,
    gender,
    image,
  };
}

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'by', 'and', 'et', 'for', 'pour', 'eau', 'parfum', 'perfume', 'toilette', 'extrait', 'edp', 'edt', 'ml', 'spray']);
const GENDER_WORDS = new Set(['man', 'men', 'woman', 'women', 'homme', 'femme', 'him', 'her', 'unisex', 'mixte']);
const plainTokens = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'by', 'and', 'et', 'pour']);
const titleWords = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /^[ivx]+$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

/** "club de nuit intense man eau de toilette" → "Club de Nuit Intense Man" (sem concentração, sem a marca). */
function displayName(title: string, brand: string): string {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = title
    .replace(/\s+(eau\s+de\s+(parfum|toilette|cologne)|extrait(\s+de\s+parfum)?|parfum|edp|edt|cologne)\b.*$/i, '')
    .replace(new RegExp(`^\\s*${escaped}\\s+|\\s+(by\\s+)?${escaped}\\s*$`, 'i'), '')
    .trim();
  return titleWords(name || title);
}

/**
 * Todas as palavras do título do catálogo estão no endereço? Artigos e palavras de concentração não contam;
 * siglas valem pelas iniciais ("cdn" = Club de Nuit). Palavras de gênero só contam se o endereço tiver alguma.
 */
function covered(title: string[], slug: Set<string>, slugHasGender: boolean): boolean {
  const need = title.filter((w) => !STOP.has(w) && (slugHasGender || !GENDER_WORDS.has(w)));
  if (!need.length) return false;
  let i = 0;
  while (i < title.length) {
    const w = title[i];
    if (slug.has(w) || STOP.has(w) || (!slugHasGender && GENDER_WORDS.has(w))) {
      i++;
      continue;
    }
    // Sigla: "cdn" cobre "club de nuit" (2 a 4 palavras seguidas, iniciais em ordem).
    let matched = false;
    for (let n = 4; n >= 2 && !matched; n--) {
      if (i + n > title.length) continue;
      const initials = title.slice(i, i + n).map((t) => t[0]).join('');
      if (slug.has(initials)) {
        i += n;
        matched = true;
      }
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Identidade SEM buscador: o catálogo da marca na Parfumo contra as palavras do endereço. Com a marca vinda do
 * endereço, lê o catálogo dela; sem marca, tenta as primeiras 1–2 palavras do nome como marca. Escolhe o título
 * mais longo totalmente coberto pelo endereço ("Asad" ⊂ "asad oriental epice ambre vanille"; "Khamrah Qahwa"
 * não entra se o link não diz "qahwa"). Nada coberto = nada inventado.
 */
export async function identifyFromCatalog(brandHint: string | null, slugName: string): Promise<{ brand: string; name: string; url: string; ambiguous: boolean } | null> {
  const words = plainTokens(slugName);
  const attempts: { brand: string; rest: string[] }[] = brandHint
    ? [{ brand: brandHint, rest: words }]
    : [1, 2].filter((n) => words.length > n).map((n) => ({ brand: words.slice(0, n).join(' '), rest: words.slice(n) }));
  for (const { brand, rest } of attempts) {
    const catalog = await brandCatalog(brand).catch(() => null);
    if (!catalog) continue;
    const slug = new Set(rest);
    const brandTokens = new Set(plainTokens(brand));
    const slugHasGender = rest.some((w) => GENDER_WORDS.has(w));
    const core = (t: string[]) => t.filter((w) => !STOP.has(w)).join(' ');
    const hits = catalog.items
      .map((item) => {
        const t = plainTokens(item.title).filter((w) => !brandTokens.has(w));
        // A Parfumo desempata nomes repetidos com "-1", "-2" no endereço ("asad-1"): não é parte do nome.
        const dup = /-(\d+)$/.exec(item.url)?.[1];
        if (dup && t.at(-1) === dup && !slug.has(dup)) t.pop();
        return { item, t };
      })
      .filter(({ t }) => covered(t, slug, slugHasGender))
      .sort((a, b) => core(b.t).split(' ').length - core(a.t).split(' ').length);
    if (!hits.length) continue;
    // Nome mais longo coberto; na mesma linha (EDT × EDP), a concentração do endereço desempata.
    const size = core(hits[0].t).split(' ').length;
    const lines = new Set(hits.filter((h) => core(h.t).split(' ').length === size).map((h) => core(h.t)));
    let top = hits.filter((h) => core(h.t) === core(hits[0].t));
    const wantEdt = rest.some((w) => w === 'edt' || w === 'toilette');
    const wantEdp = rest.some((w) => w === 'edp') || (rest.includes('parfum') && !wantEdt);
    const byConc = top.filter((h) => (wantEdt && h.t.includes('toilette')) || (wantEdp && h.t.includes('parfum') && !h.t.includes('extrait')));
    if (byConc.length) top = byConc;
    const brandName = titleWords(catalog.slug.replace(/_(Perfumes|Parfums|Fragrances)$/i, '').replace(/[_-]/g, ' '));
    const title = top[0].t.join(' ');
    return { brand: brandName, name: displayName(title, brandName), url: top[0].item.url, ambiguous: lines.size > 1 };
  }
  return null;
}

export async function findOnParfumo(brand: string, name: string, hints: string[] = []): Promise<FragranticaPerfume | null> {
  const catalog = await brandCatalog(brand).catch(() => null);
  if (!catalog) return null;
  // "asad 1" (endereço asad-1): o número só desempata nomes repetidos na Parfumo.
  const title = (p: Listed) => {
    const dup = /-(\d+)$/.exec(p.url)?.[1];
    return dup && !new RegExp(`\\b${dup}\\b`).test(name) ? p.title.replace(new RegExp(`\\s+${dup}$`), '') : p.title;
  };
  const ranked = catalog.items
    .map((p) => ({ p, score: nameSimilarity(name, title(p), brand) + concentrationAdjust(title(p), hints[0]) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.72) return null;
  const concentration = hints.join(' ').toLowerCase();
  const tied = ranked.filter((r) => r.score >= best.score - 0.001);
  const pick = tied.length > 1 ? (tied.find((r) => /extrait|elixir|intense/i.test(r.p.title) === /extrait|elixir|intense/.test(concentration)) ?? tied[0]) : best;
  return cached(`parfumo:perfume:${pick.p.url}`, 30 * DAY, async () => {
    const page = await get(pick.p.url);
    const parsed = page ? parseParfumoPage(page.body, page.url, brand) : null;
    if (parsed && catalog.slug && !brandMatches(brand, catalog.slug.replace(/_/g, ' '))) return null;
    return parsed;
  });
}

/** Só para os testes. */
export const __catalogRules = { covered, displayName, plainTokens };
