/**
 * Texto de loja → campos do perfume. Lojas escrevem o mesmo produto de mil jeitos
 * ("Afnan Supremacy In Heaven Eau de Parfum pour homme | notino.fr", "…EDP 100ml Unisexe…").
 * Aqui só se reconhece o que está escrito; o que não aparece fica nulo.
 */

import type { Gender } from './perfume';

const CONCENTRATIONS: { label: string; pattern: RegExp }[] = [
  { label: 'Extrait de Parfum', pattern: /\bextrait(?:\s+de\s+parfum)?\b/i },
  { label: 'Elixir', pattern: /\belixir\b/i },
  { label: 'Eau de Parfum', pattern: /\beau\s+de\s+parfum\b|\bedp\b/i },
  { label: 'Eau de Toilette', pattern: /\beau\s+de\s+toilette\b|\bedt\b|\btoilette\b/i },
  { label: 'Eau de Cologne', pattern: /\beau\s+de\s+cologne\b|\bedc\b|\bcologne\b/i },
  { label: 'Parfum', pattern: /\b(?:pure\s+)?parfum\b|\bperfume\b/i },
];

export function detectConcentration(text: string): string | null {
  return CONCENTRATIONS.find((c) => c.pattern.test(text))?.label ?? null;
}

export function detectVolume(text: string): string | null {
  const multi = /\b(\d{1,3})\s*(?:ml)?\s*(?:\/|&|et|and|e)\s*(\d{1,3})\s*ml\b/i.exec(text);
  if (multi) return `${multi[1]}/${multi[2]} ml`;
  const one = /\b(\d{1,4}(?:[.,]\d)?)\s*ml\b/i.exec(text);
  return one ? `${one[1].replace('.', ',')} ml` : null;
}

export function detectGender(text: string): Gender | null {
  if (/\b(mixte|unisex|unisexe|unissex|unisexo)\b/i.test(text)) return 'unisex';
  if (/\bpour\s+homme\b|\bfor\s+men\b|\bmasculin[oe]?\b|\bhomme\b|\bmen\b/i.test(text)) return 'masculine';
  if (/\bpour\s+femme\b|\bfor\s+women\b|\bf[ée]minin[oe]?\b|\bfemme\b|\bwomen\b/i.test(text)) return 'feminine';
  return null;
}

const NOISE = [
  /\bextrait\s+de\s+parfum\b/gi,
  /\beau\s+de\s+(?:parfum|toilette|cologne)\b/gi,
  /\b(?:edp|edt|edc)\b/gi,
  /\b(?:pure\s+)?parfum\b(?=\s*(?:pour|for|mixte|unisex|$|\d|[-–|(]))/gi,
  /\bpour\s+(?:homme|femme)\b/gi,
  /\bfor\s+(?:men|women)\b/gi,
  /\b(?:mixte|unisexe?|unissex)\b/gi,
  /\(\s*unisexe?\s*\)/gi,
  /\b\d{1,3}\s*(?:ml)?\s*(?:\/|&|et|and)\s*\d{1,3}\s*ml\b/gi,
  /\b\d{1,4}(?:[.,]\d)?\s*ml\b/gi,
  /\b\d(?:[.,]\d)?\s*fl\.?\s*oz\b/gi,
  /\bfragrance\b/gi,
];

/** Tira o sufixo de loja do <title> ("… | notino.fr", "… : Amazon.fr: Beauté et Parfum", "… – Parfum City"). */
export function stripStoreSuffix(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, '');
  t = t.replace(/\s*[|–—-]\s*(?:[^|–—-]{0,40}\.(?:com|fr|nl|co\.uk|de|es|it|be|pt|br)\b.*)$/i, '');
  // "Nome | Descrição de marketing | Outra coisa": fica o primeiro pedaço com cara de produto.
  const parts = t.split(/\s+[|]\s+/);
  return (parts[0] ?? t).trim();
}

/** Nome limpo: sem marca na frente, sem concentração, volume e gênero. */
export function cleanName(raw: string, brand: string | null): string {
  let name = stripStoreSuffix(raw);
  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    // "Mykonos x RRQ - Empire", "Mykonos - Reflection": o que vem antes do " - " e contém a marca é prefixo de marca.
    const dash = /^(.+?)\s+[-–|]\s+(.+)$/.exec(name);
    if (dash && new RegExp(`\\b${escaped}\\b`, 'i').test(dash[1])) name = dash[2];
    name = name.replace(new RegExp(`^\\s*${escaped}\\s*[-–:|]?\\s*`, 'i'), '');
    name = name.replace(new RegExp(`\\s*[-–|]?\\s*(?:by\\s+)?${escaped}\\s*$`, 'i'), '');
  }
  for (const pattern of NOISE) name = name.replace(pattern, ' ');
  // A marca pode ficar no fim só depois que o volume sai ("Club de Nuit Elite ARMAF 105ml").
  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    name = name.replace(new RegExp(`\\s*[-–|]?\\s*(?:by\\s+)?${escaped}\\s*$`, 'i'), '');
  }
  name = name
    .replace(/\s*[-–—|:,]\s*$/g, '')
    .replace(/^\s*[-–—|:,]\s*/g, '')
    .replace(/\s+[-–—]\s+(?=[-–—]|$)/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || stripStoreSuffix(raw);
}

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (/^\d/.test(w) || /^(de|du|la|le|of|x)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

export interface SlugGuess {
  brand: string | null;
  name: string | null;
  concentration: string | null;
  volume: string | null;
  gender: Gender | null;
}

/**
 * Palpite a partir só do endereço, para quando não dá para abrir a página (no link do claude.ai, ou loja
 * que bloqueia). notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte → Afnan · Supremacy In Heaven · EdP · Unissex.
 */
export function guessFromUrl(raw: string): SlugGuess {
  const empty: SlugGuess = { brand: null, name: null, concentration: null, volume: null, gender: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return empty;
  }
  let parts = url.pathname.split('/').map((s) => decodeURIComponent(s).replace(/\.(html?|php|aspx?)$/i, ''));
  // Amazon: o nome vem ANTES de /dp/ (ou /gp/product/); depois só há ASIN e "ref=sr_1_3".
  const dp = parts.findIndex((s) => /^(dp|gp)$/i.test(s));
  if (dp > 0) parts = parts.slice(0, dp);
  const segments = parts
    .filter((s) => !/^ref[=_]/i.test(s) && !/^index[_-]?\d+$/i.test(s))
    .filter((s) => s && !/^(fr|en|nl|de|es|it|pt|br|products?|p|dp|produit|item|shop|collections?|perfumes?|parfums?|fragrances?|au-quotidien|hygiene-soin-beaute)$/i.test(s))
    .filter((s) => !/^[a-z]?-?\d[\w-]*$/i.test(s) && !/^f-\d/.test(s) && !/^[A-Z0-9]{10}$/.test(s));
  if (segments.length === 0) return empty;

  const words = (s: string) => s.replace(/[_+]+/g, ' ').replace(/-+/g, ' ').trim();
  // Códigos de produto grudados no slug (P3372018, s274180) não são nome.
  const last = words(segments[segments.length - 1])
    .split(' ')
    .filter((w) => !/^[a-z]{0,3}\d{4,}[a-z]?$/i.test(w) && !/^(spray|vapo|vaporisateur|vaporizador|flacon)$/i.test(w))
    .join(' ');
  const brandSeg = segments.length >= 2 ? words(segments[segments.length - 2]) : null;
  const text = segments.map(words).join(' ');
  const brand = brandSeg && brandSeg.length <= 30 && !/\d{3,}/.test(brandSeg) ? titleCase(brandSeg) : null;
  const name = cleanName(titleCase(last), brand);
  return {
    brand,
    name: name && name.length >= 2 ? name : null,
    concentration: detectConcentration(text),
    volume: detectVolume(text.replace(/(\d+)\s*ml/gi, '$1 ml')),
    gender: detectGender(text),
  };
}

/** "35,10 €" / "£29.99" / "EUR 48.63" → { price, currency }. */
export function parsePrice(raw: unknown, currencyHint?: string | null): { price: number | null; currency: string | null } {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { price: raw, currency: currencyHint ?? null };
  if (typeof raw !== 'string') return { price: null, currency: currencyHint ?? null };
  const currency = /€|eur/i.test(raw) ? 'EUR' : /£|gbp/i.test(raw) ? 'GBP' : /\$|usd/i.test(raw) ? 'USD' : /r\$|brl/i.test(raw) ? 'BRL' : (currencyHint ?? null);
  const m = /(\d{1,3}(?:[ . ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/.exec(raw);
  if (!m) return { price: null, currency };
  let n = m[1].replace(/[  ]/g, '');
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(/,/g, '');
  const price = Number(n);
  return { price: Number.isFinite(price) ? price : null, currency };
}
