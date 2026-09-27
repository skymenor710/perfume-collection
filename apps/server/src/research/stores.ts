import { brandMatches, concentrationAdjust, nameSimilarity } from '@perfumes/core/match';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch } from '../net/safe-fetch';
import { volumeFromText, type VariantInfo } from '../import/variants';
import { cached, DAY, HOUR } from './cache';

/**
 * Lojas Shopify como fonte: a loja OFICIAL da marca (prioridade 1 para fotos e notas) e revendedoras
 * conhecidas. Cada loja publica o próprio catálogo em /products.json — a vitrine pública delas, feita para
 * ser lida. Uma leitura por loja por dia (cache), nunca /search (proibido no robots.txt padrão da Shopify).
 */

export interface StoreProduct {
  store: string;
  title: string;
  vendor: string;
  url: string;
  /** Cada foto sabe de quais variantes é (variant_ids): é assim que a foto do 50 ml não vira a do 100 ml. */
  images: { src: string; width: number; height: number; variantIds?: string[] }[];
  bodyHtml: string;
  price: number | null;
  variants?: VariantInfo[];
}

/** Lojas oficiais conferidas à mão (26/09/2026). Marcas fora da lista passam pela descoberta automática. */
const OFFICIAL: Record<string, string[]> = {
  afnan: ['afnan.com'],
  armaf: ['armafperfume.com'],
  'maison asrar': ['maisonasrar.com'],
  rayhaan: ['rayhaanperfumes.com'],
  mykonos: ['officialmykonos.com'],
  khadlaj: ['khadlaj-perfumes.com'],
  'french avenue': ['frenchavenue.com'],
  'swiss arabian': ['swissarabian.com'],
  // Distribuidora oficial da Lattafa nos EUA (lattafa.com recusa leitura automática) — conferida em 27/09/2026.
  lattafa: ['lattafa-usa.com'],
  'paris corner': ['pariscornerperfumes.com'],
};

/** Revendedoras Shopify de perfumaria árabe/nicho que já apareceram na planilha — fonte secundária de fotos. */
const RETAILERS = ['arabicparfums.com', 'royaloudleicester.com', 'parfumcity.nl'];

const key = (brand: string) => brand.toLowerCase().replace(/[×x]\s*rrq/, '').replace(/\s+/g, ' ').trim();

async function catalog(domain: string): Promise<StoreProduct[]> {
  return cached(`shopify:catalog:${domain}`, DAY, async () => {
    const out: StoreProduct[] = [];
    for (let page = 1; page <= 6; page++) {
      const url = new URL(`https://${domain}/products.json?limit=250&page=${page}`);
      if (!(await isAllowedByRobots(url))) break;
      await waitTurn(url.host);
      let products: Record<string, unknown>[];
      try {
        const res = await safeFetch(url.toString(), { accept: 'json', timeoutMs: 15_000, maxBytes: 12 * 1024 * 1024 });
        products = (JSON.parse(res.body) as { products?: Record<string, unknown>[] }).products ?? [];
      } catch {
        break;
      }
      for (const p of products) {
        const images = Array.isArray(p.images)
          ? (p.images as { src?: string; width?: number; height?: number; variant_ids?: number[] }[])
              .filter((i) => typeof i.src === 'string')
              .map((i) => ({ src: i.src!.replace(/^\/\//, 'https://'), width: i.width ?? 0, height: i.height ?? 0, variantIds: (i.variant_ids ?? []).map(String) }))
          : [];
        const variant = Array.isArray(p.variants) ? (p.variants[0] as { price?: string } | undefined) : undefined;
        const productUrl = `https://${domain}/products/${String(p.handle ?? '')}`;
        const variants: VariantInfo[] = (Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : []).map((v) => {
          const id = String(v.id);
          const label = String(v.title ?? '');
          const vol = volumeFromText([label, v.option1, v.option2, v.sku].filter(Boolean).join(' '));
          const featured = (v.featured_image as { src?: string } | null)?.src ?? images.find((i) => i.variantIds?.includes(id))?.src ?? null;
          return {
            id,
            label,
            volume: vol?.volume ?? null,
            volumeMl: vol?.ml ?? null,
            price: v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
            currency: null,
            sku: typeof v.sku === 'string' && v.sku ? v.sku : null,
            available: typeof v.available === 'boolean' ? v.available : null,
            image: featured ? featured.replace(/^\/\//, 'https://') : null,
            url: `${productUrl}?variant=${id}`,
          };
        });
        out.push({
          store: domain,
          title: String(p.title ?? ''),
          vendor: String(p.vendor ?? ''),
          url: productUrl,
          images,
          variants,
          // A descrição só interessa pelas notas: guarda um trecho, não o HTML inteiro.
          bodyHtml: String(p.body_html ?? '').slice(0, 6000),
          price: variant?.price ? Number(variant.price) : null,
        });
      }
      if (products.length < 250) break;
    }
    return out;
  });
}

/** Tenta achar a loja oficial de uma marca desconhecida: dominio.com, dominioperfumes.com… conferindo o "vendor". */
async function discoverOfficial(brand: string): Promise<string[]> {
  const base = key(brand).replace(/[^a-z0-9]+/g, '');
  const dashed = key(brand).replace(/[^a-z0-9]+/g, '-');
  if (!base) return [];
  return cached(`shopify:official:${base}`, 30 * DAY, async () => {
    const guesses = [...new Set([`${base}.com`, `${base}perfumes.com`, `${base}perfume.com`, `${dashed}-perfumes.com`, `official${base}.com`, `${base}parfums.com`])];
    for (const domain of guesses) {
      try {
        const url = new URL(`https://${domain}/products.json?limit=5`);
        await waitTurn(url.host);
        const res = await safeFetch(url.toString(), { accept: 'json', timeoutMs: 8000, maxBytes: 2 * 1024 * 1024 });
        const products = (JSON.parse(res.body) as { products?: { vendor?: string; title?: string; product_type?: string; tags?: string[] | string }[] }).products ?? [];
        if (products.some((p) => brandMatches(brand, p.vendor ?? ''))) return [domain];
        // "marca.com" que vende perfume é a loja da marca mesmo quando o "vendor" vem abreviado (Xerjoff → "XJ").
        const sellsFragrance = products.some((p) => /parfum|perfume|fragrance|eau de|extrait|cologne|sample|attar/i.test(`${p.title ?? ''} ${p.product_type ?? ''} ${[p.tags ?? ''].flat().join(' ')}`));
        if (domain === `${base}.com` && sellsFragrance) return [domain];
      } catch {
        /* não é uma loja dessa marca */
      }
    }
    return [];
  }).catch(() => []);
}

export interface StoreMatch {
  product: StoreProduct;
  score: number;
  official: boolean;
}

/** Produtos que correspondem ao perfume, da loja oficial primeiro, depois revendedoras. */
export async function findInStores(brand: string, name: string, extraRetailer?: string | null, concentration?: string | null): Promise<StoreMatch[]> {
  const officialDomains = OFFICIAL[key(brand)] ?? (await discoverOfficial(brand));
  const retailers = [...new Set([...RETAILERS, ...(extraRetailer ? [extraRetailer] : [])])].filter((d) => !officialDomains.includes(d));
  const matches: StoreMatch[] = [];
  for (const [domains, official] of [
    [officialDomains, true],
    [retailers, false],
  ] as const) {
    for (const domain of domains) {
      const products = await catalog(domain).catch(() => []);
      for (const product of products) {
        // Kits, amostras, sabonetes e desodorantes do mesmo nome não servem de foto do frasco.
        if (/discovery|kit|gift set|coffret|sample|trial|deodorant|body spray|mist|soap|lotion|shower/i.test(product.title)) continue;
        if (!official && !brandMatches(brand, product.vendor) && !product.title.toLowerCase().includes(key(brand).split(' ')[0])) continue;
        const score = nameSimilarity(name, product.title, brand) + concentrationAdjust(product.title, concentration);
        if (score >= 0.72) matches.push({ product, score, official });
      }
    }
  }
  return matches.sort((a, b) => Number(b.official) - Number(a.official) || b.score - a.score).slice(0, 4);
}

export const storeCacheTtl = HOUR;
