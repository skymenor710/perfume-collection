import { guessFromUrl, type SlugGuess } from '../../src/core/normalize';

/**
 * Tudo o que o próprio endereço entrega, sem abrir a página: link limpo (sem rastreadores), domínio,
 * palpite de marca/nome/concentração/volume pelo slug, e identificadores de produto (ASIN, EAN, códigos de loja).
 */

const TRACKING = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_[a-z]+|_ga|_gl|igshid|srsltid|ref|ref_|tag|psc|th|linkcode|linkid|camp|creative|ascsubtag|spm|scm|_pos|_sid|_ss|_psq|_v|pr_[a-z_]+|sc_[a-z]+|cjevent|irclickid|awc|ranmid|ranEAID|ransiteid)$/i;

export interface UrlClue {
  /** O link como a pessoa colou (é ele que o ↗ abre). */
  original: string;
  /** Sem rastreadores e sem âncora — usado para achar duplicatas e buscar. */
  normalized: string;
  host: string;
  guess: SlugGuess;
  ids: { asin?: string; ean?: string; storeCode?: string };
  /** Texto legível do caminho, para buscar quando o slug não diz o nome ("amazon.fr/dp/B0…"). */
  words: string;
}

export function analyzeUrl(raw: string): UrlClue | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const original = url.toString();
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.hash = '';
  const normalized = url.toString();
  const path = decodeURIComponent(url.pathname);
  const ids: UrlClue['ids'] = {};
  const asin = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(path)?.[1];
  if (asin) ids.asin = asin.toUpperCase();
  const ean = url.searchParams.get('ean') ?? url.searchParams.get('gtin') ?? /\b(\d{13})\b/.exec(path)?.[1];
  if (ean && /^\d{8,14}$/.test(ean)) ids.ean = ean;
  const code = /\/p-(\d{5,})\/?$/.exec(path)?.[1] ?? /\/f-\d+-([a-z0-9]+)\.html$/i.exec(path)?.[1];
  if (code) ids.storeCode = code;
  const words = path
    .split('/')
    .filter((s) => s && !/^(dp|gp|product|products|p|fr|en|nl|de|es|it|pt)$/i.test(s))
    .join(' ')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  return { original, normalized, host: url.hostname.replace(/^www\./, ''), guess: guessFromUrl(normalized), ids, words };
}

/** Identidade escrita no endereço de uma base de perfumes (quando aparece num resultado de busca). */
export function identityFromDatabaseUrl(raw: string): { brand: string; name: string; source: string } | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (/fragrantica\./.test(host) && /^(perfume|parfum|perfumes)$/i.test(parts[0] ?? '') && parts.length >= 3) {
      const name = parts[2].replace(/-\d+\.html$/, '').replace(/-/g, ' ');
      return { brand: parts[1].replace(/-/g, ' ').replace(/\s+Perfumes?$/i, ''), name, source: 'Fragrantica' };
    }
    if (/parfumo\./.test(host) && /^perfumes$/i.test(parts[0] ?? '') && parts.length >= 3) {
      return { brand: parts[1].replace(/[_-]/g, ' ').replace(/\s+Perfumes?$/i, ''), name: parts[2].replace(/[_-]/g, ' '), source: 'Parfumo' };
    }
  } catch {
    /* não é endereço */
  }
  return null;
}
