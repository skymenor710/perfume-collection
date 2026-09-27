import * as cheerio from 'cheerio';
import { cleanName, detectConcentration, detectGender, detectVolume, parsePrice } from '../../src/core/normalize';
import type { Gender } from '../../src/core/perfume';

/**
 * HTML de página de produto → rascunho de perfume. Lê, nesta ordem de confiança:
 * JSON-LD (schema.org Product), metatags Open Graph / product:*, e por fim o <title>.
 * Nada daqui é confiável: o resultado passa por sanitizePerfume antes de ser guardado.
 */

export interface ProductDraft {
  name: string | null;
  brand: string | null;
  description: string | null;
  images: string[];
  price: number | null;
  currency: string | null;
  concentration: string | null;
  volume: string | null;
  gender: Gender | null;
}

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function decodeEntities(s: string): string {
  return cheerio.load(`<i>${s}</i>`)('i').text();
}

function jsonLdProducts($: cheerio.CheerioAPI): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Json;
    const type = asArray(o['@type'] as string | string[]).join(' ');
    if (/\b(Product|ProductGroup|IndividualProduct)\b/.test(type)) found.push(o);
    if (o['@graph']) visit(o['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    try {
      visit(JSON.parse(raw));
    } catch {
      // Algumas lojas publicam JSON-LD com vírgula sobrando; sem heroísmo, ignora.
    }
  });
  return found;
}

function imageUrls(v: unknown): string[] {
  return asArray(v as unknown[])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str((x as Json).url) ?? str((x as Json).contentUrl) : null))
    .filter((x): x is string => Boolean(x));
}

function offerPrice(offers: unknown): { price: number | null; currency: string | null } {
  for (const offer of asArray(offers as Json[])) {
    if (!offer || typeof offer !== 'object') continue;
    const currency = str(offer.priceCurrency);
    const raw = offer.price ?? offer.lowPrice ?? (offer.priceSpecification as Json | undefined)?.price;
    const parsed = parsePrice(typeof raw === 'string' ? raw.replace(',', '.') : raw, currency);
    if (parsed.price !== null) return parsed;
  }
  return { price: null, currency: null };
}

export function extractProduct(html: string, pageUrl: string): ProductDraft {
  const $ = cheerio.load(html);
  const meta = (key: string) => str($(`meta[property="${key}"]`).attr('content')) ?? str($(`meta[name="${key}"]`).attr('content'));

  const products = jsonLdProducts($);
  const ld = products[0] ?? {};
  const ldBrand = (() => {
    const b = ld.brand;
    if (typeof b === 'string') return b;
    if (Array.isArray(b)) return str((b[0] as Json | undefined)?.name);
    if (b && typeof b === 'object') return str((b as Json).name);
    return null;
  })();

  const amazonTitle = str($('#productTitle').text());
  const rawName = str(ld.name) ?? amazonTitle ?? meta('og:title') ?? str($('title').first().text());
  const brand = ldBrand ?? meta('product:brand') ?? meta('og:brand') ?? str($('#bylineInfo').text()?.replace(/^(visiter la boutique|marque|brand)\s*:?\s*/i, '').replace(/\s*store$/i, '')) ?? null;
  // "Parfum City" como marca de um Rayhaan: lojas às vezes põem o próprio nome no brand do JSON-LD.
  const siteName = meta('og:site_name');
  const trustedBrand = brand && siteName && brand.toLowerCase() === siteName.toLowerCase() ? null : brand;

  const description = cleanDescription(str(ld.description) ?? meta('og:description') ?? meta('description'));

  const images = [
    ...imageUrls(ld.image),
    ...products.slice(1).flatMap((p) => imageUrls(p.image)),
    ...(() => {
      const hi = /"hiRes":"(https:[^"]+)"/.exec(html)?.[1] ?? /"large":"(https:[^"]+)"/.exec(html)?.[1];
      return hi ? [hi] : [];
    })(),
    meta('og:image:secure_url'),
    meta('og:image'),
    meta('twitter:image'),
  ]
    .filter((x): x is string => Boolean(x))
    .map((u) => {
      try {
        return new URL(u.replace(/^\/\//, 'https://'), pageUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((x): x is string => Boolean(x));

  const ldPrice = offerPrice(ld.offers);
  const metaPrice = parsePrice(meta('product:price:amount') ?? meta('og:price:amount'), meta('product:price:currency') ?? meta('og:price:currency'));
  const amazonPrice = parsePrice(str($('.a-price .a-offscreen').first().text()), 'EUR');
  const price = ldPrice.price !== null ? ldPrice : metaPrice.price !== null ? metaPrice : amazonPrice;

  const nameText = rawName ? decodeEntities(rawName) : null;
  const allText = [nameText, description, pageUrl].filter(Boolean).join(' ');
  return {
    name: nameText ? cleanName(nameText, trustedBrand) : null,
    brand: trustedBrand ? decodeEntities(trustedBrand) : null,
    description: description ? decodeEntities(description).slice(0, 600) : null,
    images: [...new Set(images)],
    price: price.price,
    currency: price.currency,
    concentration: detectConcentration(nameText ?? '') ?? detectConcentration(allText),
    volume: detectVolume(nameText ?? '') ?? detectVolume(allText),
    gender: detectGender(nameText ?? '') ?? detectGender(pageUrl),
  };
}

/** Descrição de verdade, não o texto de SEO da loja ("Achetez… ✓ Livraison gratuite…"). */
export function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 40) return null;
  if (/\bachetez\b|livraison|en stock sur|prix imbattables|free (?:shipping|delivery)|buy now|shop now|authentiques à des prix|✓|❤/i.test(text)) return null;
  return text;
}

/** Sinais de página de bloqueio anti-robô (captcha, "Robot Check", casca vazia). Não se tenta contornar. */
export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (html.length < 2500) return true;
  return /captcha|robot check|are you a human|access denied|datadome|px-captcha|cf-chl|challenge-platform/i.test(html.slice(0, 20000)) && !/application\/ld\+json/.test(html);
}

/**
 * Troca a miniatura pela foto grande quando o endereço da CDN deixa claro como pedir.
 * (A notino, por exemplo, publica no JSON-LD uma miniatura de 140px chamada "order_2k".)
 */
export function upgradeImageUrl(url: string): string {
  let u = url;
  u = u.replace(/cdn\.notinoimg\.com\/(?:order_2k|social|detail_main_lq|detail_main_mq|detail_thumb)\//, 'cdn.notinoimg.com/detail_main_hq/');
  u = u.replace(/(\/cdn\/shop\/[^?]+?)_(?:\d+x\d*|\d*x\d+)(\.\w+)/, '$1$2');
  u = u.replace(/(m\.media-amazon\.com\/images\/I\/[^.]+)\.[^/]*?\.(jpg|png)$/, '$1._AC_SL1500_.$2');
  return u;
}
