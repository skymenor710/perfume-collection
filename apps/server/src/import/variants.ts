import * as cheerio from 'cheerio';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch } from '../net/safe-fetch';

/**
 * Variantes de um produto (50 ml × 100 ml, EDT × EDP, tester…). Um perfume não é só marca + nome: é UMA variante
 * real, e tamanho, preço, moeda, SKU, disponibilidade, link e FOTO andam juntos, como um objeto só — nunca se
 * resolvem separados (é assim que se evita "50 ml com a foto do 100 ml").
 *
 * Fontes, na ordem em que aparecem na página:
 *   - Shopify: /products/<handle>.js (a própria loja publica; cada variante com sua foto);
 *   - WooCommerce: o formulário de variações (data-product_variations);
 *   - JSON-LD: ProductGroup.hasVariant ou várias ofertas no mesmo Product.
 */

export interface VariantInfo {
  /** Id da loja (Shopify/WooCommerce) ou SKU; estável para a mesma loja. */
  id: string;
  /** Como a loja chama ("50ml", "100 ml / Tester"). */
  label: string;
  /** Normalizado para exibir ("50 ml"). */
  volume: string | null;
  volumeMl: number | null;
  price: number | null;
  currency: string | null;
  sku: string | null;
  available: boolean | null;
  /** Foto desta variante, quando a loja liga foto e variante. */
  image: string | null;
  /** Link da loja já com esta variante escolhida. */
  url: string | null;
  /** Atributos da variação (WooCommerce), para reconhecer a escolha no link. */
  attrs?: Record<string, string>;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** "50ml", "50 ML", "1.7 oz", "3,4 fl oz" → { volume: "50 ml", ml: 50 }. Onças viram o tamanho comercial em ml. */
export function volumeFromText(text: string | null | undefined): { volume: string; ml: number } | null {
  if (!text) return null;
  const ml = /(\d{1,4}(?:[.,]\d+)?)\s*(?:ml|mls|millilit(?:er|re)s?)\b/i.exec(text);
  if (ml) {
    const n = Number(ml[1].replace(',', '.'));
    if (n > 0 && n <= 1000) return { volume: `${String(n).replace('.', ',')} ml`, ml: n };
  }
  const oz = /(\d{1,2}(?:[.,]\d+)?)\s*(?:fl\.?\s*)?oz\b/i.exec(text);
  if (oz) {
    const raw = Number(oz[1].replace(',', '.')) * 29.5735;
    // Frascos seguem tamanhos comerciais: 3.4 oz = 100 ml, 1.7 oz = 50 ml, 1 oz = 30 ml.
    const common = [5, 7.5, 10, 15, 20, 25, 30, 35, 40, 50, 55, 60, 75, 80, 90, 100, 105, 110, 120, 125, 150, 200, 250];
    const n = common.reduce((best, c) => (Math.abs(c - raw) < Math.abs(best - raw) ? c : best), common[0]);
    if (Math.abs(n - raw) / raw < 0.08) return { volume: `${n} ml`, ml: n };
  }
  return null;
}

const absolute = (u: string | null | undefined, base: string): string | null => {
  if (!u) return null;
  try {
    return new URL(u.replace(/^\/\//, 'https://'), base).toString();
  } catch {
    return null;
  }
};

/** Resposta de /products/<handle>.js (preço em centavos). */
export function parseShopifyProductJs(product: Json, productUrl: string, currency: string | null): VariantInfo[] {
  const variants = Array.isArray(product.variants) ? (product.variants as Json[]) : [];
  const base = new URL(productUrl);
  base.search = '';
  base.hash = '';
  return variants
    .map((v): VariantInfo | null => {
      const id = str(v.id);
      if (!id) return null;
      const label = str(v.title) ?? [v.option1, v.option2, v.option3].map(str).filter(Boolean).join(' / ');
      const text = [label, v.option1, v.option2, v.option3, v.sku, v.name].map(str).filter(Boolean).join(' ');
      const vol = volumeFromText(text);
      const cents = typeof v.price === 'number' ? v.price : Number(v.price);
      const featured = v.featured_image as Json | null | undefined;
      const url = new URL(base);
      url.searchParams.set('variant', id);
      return {
        id,
        label: label || 'Padrão',
        volume: vol?.volume ?? null,
        volumeMl: vol?.ml ?? null,
        price: Number.isFinite(cents) ? Math.round(cents) / 100 : null,
        currency,
        sku: str(v.sku),
        available: typeof v.available === 'boolean' ? v.available : null,
        image: absolute(str(featured?.src), productUrl),
        url: url.toString(),
      };
    })
    .filter((v): v is VariantInfo => v !== null);
}

/** Formulário de variações do WooCommerce. */
export function parseWooVariations(html: string, pageUrl: string, currency: string | null): VariantInfo[] {
  const $ = cheerio.load(html);
  const raw = $('form.variations_form').attr('data-product_variations');
  if (!raw || raw === 'false') return [];
  let list: Json[];
  try {
    list = JSON.parse(raw) as Json[];
  } catch {
    return [];
  }
  return list
    .map((v): VariantInfo | null => {
      const id = str(v.variation_id);
      if (!id) return null;
      const attrs = Object.fromEntries(Object.entries((v.attributes as Json) ?? {}).map(([k, val]) => [k, str(val) ?? '']));
      const label = Object.values(attrs).filter(Boolean).join(' / ') || str(v.sku) || id;
      const vol = volumeFromText(`${label.replace(/-/g, ' ')} ${str(v.sku) ?? ''}`);
      const image = v.image as Json | undefined;
      const url = new URL(pageUrl);
      for (const [k, val] of Object.entries(attrs)) if (val) url.searchParams.set(k, val);
      return {
        id,
        label,
        volume: vol?.volume ?? null,
        volumeMl: vol?.ml ?? null,
        price: typeof v.display_price === 'number' ? v.display_price : null,
        currency,
        sku: str(v.sku),
        available: typeof v.is_in_stock === 'boolean' ? v.is_in_stock : null,
        image: absolute(str(image?.full_src) ?? str(image?.src) ?? str(image?.url), pageUrl),
        url: url.toString(),
        attrs,
      };
    })
    .filter((v): v is VariantInfo => v !== null);
}

/** JSON-LD: ProductGroup.hasVariant, ou um Product com várias ofertas de tamanhos diferentes. */
export function parseJsonLdVariants(html: string, pageUrl: string): VariantInfo[] {
  const $ = cheerio.load(html);
  const nodes: Json[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as Json;
    const type = [o['@type']].flat().join(' ');
    if (/\b(Product|ProductGroup)\b/.test(type)) nodes.push(o);
    if (o['@graph']) visit(o['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      /* JSON-LD quebrado: ignora */
    }
  });
  const out: VariantInfo[] = [];
  const offerOf = (o: unknown) => [o].flat()[0] as Json | undefined;
  const add = (name: string | null, sku: string | null, offer: Json | undefined, image: unknown, size: unknown) => {
    const text = [str(size), name, sku, str(offer?.name)].filter(Boolean).join(' ');
    const vol = volumeFromText(text);
    const price = offer ? Number(String(offer.price ?? offer.lowPrice ?? '').replace(',', '.')) : NaN;
    const img = [image].flat()[0];
    out.push({
      id: sku ?? str(offer?.sku) ?? str(offer?.url) ?? `${out.length}`,
      label: vol?.volume ?? name ?? sku ?? `Opção ${out.length + 1}`,
      volume: vol?.volume ?? null,
      volumeMl: vol?.ml ?? null,
      price: Number.isFinite(price) ? price : null,
      currency: str(offer?.priceCurrency),
      sku: sku ?? str(offer?.sku),
      available: offer?.availability ? /InStock|LimitedAvailability|PreOrder/i.test(String(offer.availability)) : null,
      image: absolute(typeof img === 'string' ? img : str((img as Json | undefined)?.url), pageUrl),
      url: absolute(str(offer?.url), pageUrl),
    });
  };
  for (const node of nodes) {
    if (Array.isArray(node.hasVariant)) {
      for (const v of node.hasVariant as Json[]) add(str(v.name), str(v.sku), offerOf(v.offers), v.image, v.size);
    } else {
      const offers = [node.offers].flat().filter((o): o is Json => Boolean(o) && typeof o === 'object');
      const inner = offers.flatMap((o) => (Array.isArray(o.offers) ? (o.offers as Json[]) : [o]));
      if (inner.length > 1) for (const o of inner) add(str(o.name), str(o.sku), o, null, null);
    }
  }
  return out;
}

/** Só interessa escolher quando há mais de uma variante DIFERENTE (tamanho ou nome); repetidas se juntam. */
export function meaningfulVariants(variants: VariantInfo[]): VariantInfo[] {
  const byKey = new Map<string, VariantInfo>();
  for (const v of variants) {
    const key = v.volumeMl !== null ? `ml:${v.volumeMl}:${/tester/i.test(v.label) ? 't' : ''}` : `l:${v.label.toLowerCase()}`;
    const prev = byKey.get(key);
    // Entre repetidas, fica a disponível e com foto.
    if (!prev || (!prev.available && v.available) || (!prev.image && v.image)) byKey.set(key, v);
  }
  const list = [...byKey.values()];
  if (list.length <= 1) return list;
  return list.sort((a, b) => (a.volumeMl ?? 1e9) - (b.volumeMl ?? 1e9));
}

/**
 * A variante que o link já escolhe: ?variant= (Shopify), atributos do WooCommerce, ou um único tamanho escrito no
 * endereço que bate com uma variante. "…-50ml-100ml" cita os dois: não escolhe nada — não se adivinha.
 */
export function preselectedVariant(rawUrl: string, variants: VariantInfo[]): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const byParam = url.searchParams.get('variant');
  if (byParam && variants.some((v) => v.id === byParam)) return byParam;
  const attrs = [...url.searchParams.entries()].filter(([k]) => k.startsWith('attribute_'));
  if (attrs.length) {
    const hit = variants.find((v) => v.attrs && attrs.every(([k, val]) => (v.attrs![k] ?? '').toLowerCase() === val.toLowerCase()));
    if (hit) return hit.id;
  }
  const path = decodeURIComponent(url.pathname).replace(/[-_/]+/g, ' ');
  const sizes = [...path.matchAll(/(\d{2,4})\s*ml\b/gi)].map((m) => Number(m[1]));
  const distinct = [...new Set(sizes)];
  if (distinct.length === 1) {
    const hit = variants.filter((v) => v.volumeMl === distinct[0]);
    if (hit.length === 1) return hit[0].id;
  }
  return null;
}

/** Endereço de produto Shopify → handle e prefixo (idioma/coleção). */
export function shopifyHandle(rawUrl: string): { origin: string; prefix: string; handle: string } | null {
  try {
    const u = new URL(rawUrl);
    const m = /^((?:\/[a-z]{2}(?:-[a-z]{2})?)?)(?:\/collections\/[^/]+)?\/products\/([^/?#]+)\/?$/i.exec(u.pathname);
    return m ? { origin: u.origin, prefix: m[1], handle: m[2].replace(/\.(js|json)$/i, '') } : null;
  } catch {
    return null;
  }
}

/** Variantes de um produto Shopify pelo JSON público da loja (se o robots.txt permitir). */
export async function fetchShopifyVariants(rawUrl: string, currency: string | null): Promise<VariantInfo[] | null> {
  const shop = shopifyHandle(rawUrl);
  if (!shop) return null;
  const jsUrl = new URL(`${shop.origin}${shop.prefix}/products/${shop.handle}.js`);
  if (!(await isAllowedByRobots(jsUrl))) return null;
  try {
    await waitTurn(jsUrl.host);
    const res = await safeFetch(jsUrl.toString(), { accept: 'json', timeoutMs: 12_000, maxBytes: 4 * 1024 * 1024 });
    const product = JSON.parse(res.body) as Json;
    return parseShopifyProductJs(product, `${shop.origin}${shop.prefix}/products/${shop.handle}`, currency);
  } catch {
    return null;
  }
}

/** Moeda da página (Shopify publica "currency":{"active":"GBP"}; lojas em geral, og:price:currency/JSON-LD). */
export function pageCurrency(html: string): string | null {
  return /Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1] ?? /"priceCurrency"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1] ?? /property="(?:og|product):price:currency"\s+content="([A-Z]{3})"/.exec(html)?.[1] ?? null;
}
