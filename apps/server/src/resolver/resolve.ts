import { cleanName, detectConcentration, detectGender, detectVolume, stripStoreSuffix } from '@perfumes/core/normalize';
import { brandMatches, nameSimilarity } from '@perfumes/core/match';
import type { OlfactoryProfile } from '@perfumes/core/olfactory';
import type { FieldSource, FieldSourceKind, Gender } from '@perfumes/core/perfume';
import { extractProduct, looksBlocked, type ProductDraft } from '../import/extract';
import { fetchShopifyVariants, meaningfulVariants, pageCurrency, parseJsonLdVariants, parseWooVariations, preselectedVariant, type VariantInfo } from '../import/variants';
import { processBottleOffThread } from '../media/offthread';
import { isAllowedByRobots, waitTurn } from '../net/polite';
import { safeFetch, safeFetchImage } from '../net/safe-fetch';
import { identifyFromCatalog } from '../research/parfumo';
import { researchPerfume, type ChosenImage, type ImageCandidate, type ResearchResult } from '../research/perfume';
import { findInStores, type StoreMatch } from '../research/stores';
import { webSearch, type SearchResult } from './search';
import { analyzeUrl, identityFromDatabaseUrl, type UrlClue } from './url';

/**
 * Resolvedor de produto — "produto primeiro". O link colado é uma PISTA, não a fonte da verdade.
 *
 *   link → normalização → página (se abrir) → leitura do endereço → busca na internet → confirmação da
 *   identidade → dados de várias fontes (cada campo com a sua origem) → fotos → frasco → perfil olfativo
 *
 * Nenhuma etapa derruba o processo sozinha. Só se desiste quando NADA identificou o perfume com segurança.
 * Provedores: página (DirectPage), endereço (UrlParser), busca (search.ts), marca/revendedoras (lojas Shopify),
 * bases de perfumes (Fragrantica/Parfumo) e imagens — cada um trocável sem mexer no resto.
 */

export type ResolveStage = 'link' | 'identity' | 'fallback' | 'search' | 'compare' | 'images' | 'bottle' | 'notes' | 'final';

/** Uma variante oferecida para escolha, com uma miniatura do frasco (recorte rápido) quando a loja tem foto dela. */
export interface VariantChoice extends VariantInfo {
  thumb: string | null;
}

export type { FieldSource } from '@perfumes/core/perfume';
type SourceKind = FieldSourceKind;

export interface Identity {
  brand: string;
  name: string;
  concentration?: string | null;
  volume?: string | null;
}

export interface ResolvedProduct {
  identity: Identity;
  confidence: number;
  level: 'high' | 'moderate';
  gender: Gender | null;
  description: string | null;
  price: { value: number; currency: string } | null;
  fieldSources: Record<string, FieldSource>;
  /** Link como a pessoa colou (é ele que o ↗ abre) e a versão limpa (para duplicatas). */
  sourceUrl: string;
  normalizedUrl: string;
  pageBlocked: boolean;
  image: ChosenImage | null;
  imageReport: ResearchResult['imageReport'];
  olfactoryProfile: OlfactoryProfile | null;
  /** A variante real (tamanho + preço + foto + link juntos) e as outras que a loja oferece. */
  variant: VariantInfo | null;
  variants: VariantInfo[];
  evidence: string[];
}

export type ResolveOutcome =
  | { ok: true; product: ResolvedProduct }
  | {
      ok: 'choose';
      identity: Identity;
      variants: VariantChoice[];
      preselectedId: string | null;
      source: { kind: FieldSourceKind; label: string; url: string | null } | null;
      sourceUrl: string;
      evidence: string[];
    }
  | { ok: false; reason: 'invalid_url' | 'unidentified'; message: string; guess: Partial<Identity> | null; evidence: string[] };

export interface ResolveInput {
  url: string;
  /** Identidade já conhecida (migração, "pesquisar de novo") ou dita pela pessoa quando o sistema pediu. */
  identity?: Partial<Identity> | null;
  /** Fotos já conhecidas do produto (a da planilha, por exemplo): só mais candidatas, sem autoridade. */
  hintImages?: string[];
  /** Variante escolhida pela pessoa (depois da pergunta "qual versão?"). */
  variantId?: string | null;
}

/** Miniatura do frasco de uma variante (recorte rápido, sem IA) para a pergunta "qual versão?". */
async function variantThumb(url: string): Promise<string | null> {
  try {
    await waitTurn(new URL(url).host);
    const image = await safeFetchImage(url, { timeoutMs: 12_000, maxBytes: 12 * 1024 * 1024 });
    const bottle = await processBottleOffThread(image.buffer, { noAi: true });
    return `data:image/webp;base64,${bottle.small.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Sites que costumam bloquear leitura automática: nem se tenta abrir resultados de busca deles. */
const BLOCKING = /(^|\.)(notino\.[a-z.]+|amazon\.[a-z.]+|cdiscount\.com|dior\.com|chanel\.com|sephora\.[a-z.]+|douglas\.[a-z.]+|fragrantica\.[a-z.]+|ebay\.[a-z.]+|aliexpress\.com|walmart\.com|jomashop\.com)$/i;
/** Bancos de imagem com marca d'água ou licença duvidosa: nunca viram foto do frasco. */
const IMAGE_BANKS = /(pngwing|pngegg|pngtree|freepik|shutterstock|dreamstime|alamy|istockphoto|gettyimages|depositphotos|123rf|vecteezy|pngimg|kindpng|pngitem|nicepng|seekpng|stickpng|cleanpng|favpng|imgbin)\./i;

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** O endereço diz um produto e a página mostra outro, de outra marca. */
function pageContradictsLink(draft: ProductDraft, clue: UrlClue): boolean {
  if (!draft.name || !clue.guess.name) return false;
  const slug = new Set(plain(clue.words));
  if (draft.brand && plain(draft.brand).some((t) => slug.has(t))) return false;
  return nameSimilarity(clue.guess.name, draft.name, clue.guess.brand) < 0.25;
}

/**
 * Nome tirado do slug costuma vir com rabo de marketing ("Asad Oriental Epice Ambre Vanille"). Se uma base de
 * perfumes nos resultados tem a mesma marca e um nome cujas palavras estão TODAS no slug, esse é o nome.
 */
function refineSlugName(name: string, brand: string, results: SearchResult[]): string | null {
  const slug = new Set(plain(name));
  let best: string | null = null;
  for (const r of results) {
    const id = identityFromDatabaseUrl(r.url);
    if (!id || !brandMatches(brand, id.brand)) continue;
    const t = plain(id.name);
    if (t.length && t.every((w) => slug.has(w)) && (!best || t.length > plain(best).length)) best = id.name;
  }
  return best && plain(best).length < slug.size ? best : null;
}

/** Títulos de página de erro que alguns sites devolvem com status 200. */
const NOT_A_PRODUCT = /^(404\b|page (not found|introuvable)|not found|erreur|error\b|oops|página não encontrada|seite nicht gefunden|pagina niet gevonden)/i;

export async function readPage(url: string): Promise<{ draft: ProductDraft | null; blocked: boolean; html?: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { draft: null, blocked: true };
  }
  if (!(await isAllowedByRobots(u))) return { draft: null, blocked: true };
  try {
    await waitTurn(u.host);
    const page = await safeFetch(u.toString(), { allowErrorStatus: true, timeoutMs: 15_000 });
    // Página inexistente (link velho, produto fora de linha) vale o mesmo que bloqueada: o link segue como pista.
    if (page.status >= 400 || looksBlocked(page.status, page.body)) return { draft: null, blocked: true };
    const draft = extractProduct(page.body, page.url);
    if (draft?.name && NOT_A_PRODUCT.test(draft.name)) return { draft: null, blocked: true };
    return { draft, blocked: false, html: page.body };
  } catch {
    return { draft: null, blocked: true };
  }
}

const NO_LINK: UrlClue = { original: '', normalized: '', host: '', guess: { brand: null, name: null, concentration: null, volume: null, gender: null }, ids: {}, words: '' };

const words = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Primeira identidade possível a partir dos resultados de busca: endereços de bases de perfumes são os mais confiáveis. */
function identityFromResults(results: SearchResult[], hintBrand?: string | null): Identity | null {
  for (const r of results) {
    const id = identityFromDatabaseUrl(r.url);
    if (id && (!hintBrand || brandMatches(hintBrand, id.brand))) return { brand: id.brand, name: id.name };
  }
  return null;
}

export async function resolveProduct(input: ResolveInput, onStage: (s: ResolveStage) => void = () => {}): Promise<ResolveOutcome> {
  const evidence: string[] = [];
  onStage('link');
  // Sem link (perfume antigo, digitado à mão): a identidade conhecida basta — o link é só uma pista.
  const noLink = !input.url.trim() && !!input.identity?.name;
  const clue: UrlClue | null = noLink ? NO_LINK : analyzeUrl(input.url);
  if (!clue) return { ok: false, reason: 'invalid_url', message: 'Esse endereço não parece um link de página. Confira se copiou o link inteiro.', guess: null, evidence };
  if (!noLink) evidence.push(`link: ${clue.host}${clue.ids.asin ? ` (ASIN ${clue.ids.asin})` : ''}`);

  // 1. Página do link (opcional).
  onStage('identity');
  // A página vai com o link ORIGINAL: o ?variant= faz parte da escolha da pessoa.
  const page: { draft: ProductDraft | null; blocked: boolean; html?: string } = noLink ? { draft: null, blocked: false } : await readPage(clue.original);
  if (page.blocked) {
    onStage('fallback');
    evidence.push('página do link: não deixou ler — seguindo por outras fontes');
  } else if (page.draft?.name) {
    evidence.push(`página do link: "${page.draft.brand ?? '?'} · ${page.draft.name}"`);
    // Loja que redireciona produto esgotado para outro (ou para a home): a página fala de outra coisa e o
    // endereço continua sendo a melhor pista. Sem isso, "Lattafa Asad" virava um creme de barba.
    if (pageContradictsLink(page.draft, clue)) {
      evidence.push('página do link mostra outro produto (redirecionou?) — usando o endereço');
      page.draft = null;
    }
  }

  // 2. Hipótese de identidade: a pessoa/migração > página > endereço.
  const fromPage = page.draft?.name ? { brand: page.draft.brand, name: page.draft.name } : null;
  let brand = input.identity?.brand ?? fromPage?.brand ?? clue.guess.brand ?? null;
  let name = input.identity?.name ?? fromPage?.name ?? clue.guess.name ?? null;
  const concentration = input.identity?.concentration ?? page.draft?.concentration ?? clue.guess.concentration ?? null;
  const fieldSources: Record<string, FieldSource> = {};
  const src = (kind: SourceKind, label: string, url: string | null = null): FieldSource => ({ kind, label, url });
  const idKind: SourceKind = input.identity?.name ? 'user' : fromPage ? 'page' : 'url';

  // 3. Busca na internet: sem nome (ASIN, código) ou sem marca, a busca é quem identifica.
  onStage('search');
  // 3a. Base de perfumes SEM buscador: o catálogo da marca contra as palavras do endereço. Assim um buscador
  // fora do ar (ou pedindo verificação) não derruba a identificação de um link legível.
  // Vale também para página que dá o nome mas não a marca ("Mykonos - Reflection" na loja oficial): antes, só a busca
  // descobria a marca — e com o buscador pausado o perfume ficava "não identificado".
  const catalogHint =
    idKind === 'url' && clue.guess.name
      ? { brand: clue.guess.brand, name: clue.guess.name, from: 'endereço' }
      : idKind === 'page' && !brand && fromPage?.name
        ? { brand: null, name: fromPage.name, from: 'página' }
        : null;
  const fromCatalog = catalogHint ? await identifyFromCatalog(catalogHint.brand, catalogHint.name).catch(() => null) : null;
  if (fromCatalog && catalogHint) {
    brand = fromCatalog.brand;
    name = fromCatalog.name;
    evidence.push(`base de perfumes (catálogo da marca): ${catalogHint.from} "${catalogHint.name}" é "${fromCatalog.brand} · ${fromCatalog.name}"${fromCatalog.ambiguous ? ' (há variações)' : ''}`);
  }
  // 3b. Busca na internet.
  let results: SearchResult[] = [];
  if (!name || !brand) {
    // A pessoa disse "qual perfume é" sem separar a marca ("Afnan Supremacy in Heaven"): a busca separa.
    const said = input.identity?.name && !input.identity.brand ? input.identity.name : null;
    // Com nome legível no endereço, busca-se o nome; só sem ele o código (ASIN, EAN) vira a consulta.
    const slugName = !said && !input.identity?.name && !fromPage ? clue.guess.name : null;
    const query = said ? `${said} perfume` : slugName ? `${slugName} perfume` : (clue.ids.asin ?? clue.ids.ean ?? (clue.words.length > 3 ? `${clue.words} perfume` : clue.normalized));
    results = await webSearch(query);
    let fromSearch = identityFromResults(results, brand);
    // Identidade da busca tem de conversar com o que o endereço diz (senão é outro perfume da mesma busca).
    if (fromSearch && slugName && nameSimilarity(slugName, `${fromSearch.brand} ${fromSearch.name}`) < 0.5) fromSearch = null;
    if (fromSearch && slugName && !brand) {
      // O slug sem marca separada ("Armaf-Club-Nuit-Intense-Toilette") traz a marca dentro do nome: a base separa.
      brand = fromSearch.brand;
      name = fromSearch.name;
      evidence.push(`busca: endereço "${slugName}" é "${fromSearch.brand} · ${fromSearch.name}"`);
      fromSearch = null;
    }
    if (fromSearch && said && nameSimilarity(fromSearch.name, said, fromSearch.brand) >= 0.72) {
      brand = brand ?? fromSearch.brand;
      name = fromSearch.name;
      evidence.push(`busca: "${said}" é "${fromSearch.brand} · ${fromSearch.name}"`);
    } else if (said && brand) {
      name = cleanName(said, brand);
    } else if (fromSearch && !said) {
      brand = brand ?? fromSearch.brand;
      name = name ?? fromSearch.name;
      evidence.push(`busca: identificado como "${fromSearch.brand} · ${fromSearch.name}"`);
    } else if (results[0] && !name) {
      // Sem base de perfumes nos resultados: o título do primeiro resultado ainda é uma pista.
      const title = stripStoreSuffix(results[0].title);
      name = brand ? cleanName(title, brand) : title;
    }
  }
  if (!brand || !name) {
    return { ok: false, reason: 'unidentified', message: 'Não conseguimos identificar este perfume com segurança.', guess: { brand: brand ?? undefined, name: name ?? undefined }, evidence };
  }
  brand = words(brand);
  // A página às vezes não tinha marca confiável na hora de ler o nome ("Mykonos - Reflection"): limpa de novo.
  name = words(cleanName(words(name), brand) || name);

  // 2b. VARIANTES — antes de qualquer pesquisa pesada. Um produto com 50 ml e 100 ml são dois frascos: a pessoa
  // escolhe (ou o link já escolheu), e tamanho + preço + foto + link seguem juntos, da mesma variante.
  let variants: VariantInfo[] = [];
  let variantSource: { kind: SourceKind; label: string; url: string | null } | null = null;
  if (!noLink) {
    const currency = (page.html ? pageCurrency(page.html) : null) ?? page.draft?.currency ?? null;
    const fromShopify = await fetchShopifyVariants(clue.original, currency);
    const fromHtml = page.html ? [...parseWooVariations(page.html, clue.original, currency), ...parseJsonLdVariants(page.html, clue.original)] : [];
    variants = meaningfulVariants(fromShopify?.length ? fromShopify : fromHtml);
    if (variants.length) variantSource = { kind: 'page', label: clue.host, url: clue.original };
  }
  if (variants.length <= 1 && page.blocked && !input.variantId) {
    // A loja do link não deixou ler: as variantes vêm da loja oficial ou de uma revendedora com o mesmo produto.
    // O preço é o DELA (dito na origem) e o ↗ continua abrindo o link da pessoa.
    const stores = await findInStores(brand, name, null, concentration).catch(() => [] as StoreMatch[]);
    const withVariants = stores.find((m) => meaningfulVariants(m.product.variants ?? []).length > 1);
    if (withVariants) {
      variants = meaningfulVariants(withVariants.product.variants!).map((v) => ({ ...v, url: null }));
      variantSource = { kind: withVariants.official ? 'official' : 'retailer', label: withVariants.product.store, url: withVariants.product.url };
      evidence.push(`variantes por ${withVariants.product.store} (a loja do link não abriu)`);
    }
  }
  const preselectedId = preselectedVariant(clue.original, variants);
  const variant = (input.variantId ? variants.find((v) => v.id === input.variantId) : null) ?? (variants.length === 1 ? variants[0] : null);
  if (variants.length > 1 && !variant) {
    // Mais de uma variante e ninguém escolheu: pergunta ANTES de pesquisar fotos (a foto depende da escolha).
    onStage('compare');
    const choices: VariantChoice[] = [];
    for (const v of variants.slice(0, 6)) choices.push({ ...v, thumb: v.image ? await variantThumb(v.image) : null });
    evidence.push(`${variants.length} variantes: ${variants.map((v) => v.volume ?? v.label).join(', ')}${preselectedId ? ' (o link já escolhe uma)' : ''}`);
    return {
      ok: 'choose',
      identity: { brand, name, concentration },
      variants: choices,
      preselectedId,
      source: variantSource,
      sourceUrl: clue.original,
      evidence,
    };
  }
  if (variant) evidence.push(`variante: ${variant.volume ?? variant.label}${variant.price != null ? ` · ${variant.price} ${variant.currency ?? ''}` : ''}`);

  // Busca de confirmação (produto, não o endereço): "marca nome", depois com "perfume" e a concentração.
  // Mais de uma consulta, e com o tamanho quando há variante: "Mykonos Reflection 50ml" acha o frasco certo.
  const size = variant?.volumeMl ? `${variant.volumeMl}ml` : null;
  const queries = [`${brand} ${name}`, `${brand} ${name} ${concentration ?? 'perfume'}`, ...(size ? [`${brand} ${name} ${size}`] : [])];
  for (const q of queries) {
    if (results.length >= 10) break;
    results = [...results, ...(await webSearch(q))];
  }
  onStage('compare');
  if (idKind === 'url' && !fromCatalog) {
    const refined = refineSlugName(name, brand, results);
    if (refined) {
      evidence.push(`nome do endereço "${name}" → "${refined}" (base de perfumes)`);
      name = refined;
    }
  }
  const agreeing = results.filter((r) => nameSimilarity(name!, r.title, brand) >= 0.72 || (identityFromDatabaseUrl(r.url) && nameSimilarity(name!, identityFromDatabaseUrl(r.url)!.name, brand) >= 0.72));
  if (agreeing.length) evidence.push(`busca: ${agreeing.length} resultados confirmam o nome`);

  // 4. Páginas encontradas pela busca que abrem (loja oficial, revendedoras): dados e fotos extras.
  const extraImages: ImageCandidate[] = [];
  const pageFacts: { url: string; draft: ProductDraft }[] = [];
  const openable = agreeing.filter((r) => {
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, '');
      return !BLOCKING.test(h) && h !== clue.host && !IMAGE_BANKS.test(h) && !/parfumo\./.test(h);
    } catch {
      return false;
    }
  });
  for (const r of openable.slice(0, 3)) {
    const p = await readPage(r.url);
    if (!p.draft?.name || nameSimilarity(name, p.draft.name, brand) < 0.72) continue;
    pageFacts.push({ url: r.url, draft: p.draft });
    const host = new URL(r.url).hostname.replace(/^www\./, '');
    const official = brandMatches(brand, host.split('.')[0]);
    for (const img of p.draft.images.slice(0, 3)) extraImages.push({ url: img, origin: official ? 'brand' : 'retailer', pageUrl: r.url, label: host });
  }
  // PNG transparente: prioridade quando existe, sem exigir que exista.
  const pngResults = await webSearch(`${brand} ${name}${size ? ` ${size}` : ''} bottle png transparent background`);
  for (const r of pngResults.slice(0, 6)) {
    if (IMAGE_BANKS.test(r.url) || nameSimilarity(name, r.title, brand) < 0.6) continue;
    if (/\.png(\?|$)/i.test(r.url)) extraImages.push({ url: r.url, origin: 'search', pageUrl: r.url, label: 'busca (PNG)' });
  }

  // 5. Bases de perfumes, lojas oficiais e revendedoras + fotos + perfil olfativo.
  onStage('images');
  // Com variante escolhida e foto dela: essa é a foto exata; as fotos genéricas da página (que podem ser de
  // outro tamanho — a do Reflection era a do 100 ml) só entram quando a variante não tem foto própria.
  if (variant?.image) extraImages.unshift({ url: variant.image, origin: 'source', pageUrl: variant.url ?? clue.original, label: `${variantSource?.label ?? clue.host} · ${variant.volume ?? variant.label}`, exact: true, sizeMl: variant.volumeMl });
  const pageImages = variant?.image && variants.length > 1 ? [] : [...(input.hintImages ?? []), ...(page.draft?.images ?? [])];
  const research = await researchPerfume(
    { brand, name, concentration, pageImages, pageUrl: clue.normalized || null, extraImages, wantedMl: variants.length > 1 ? (variant?.volumeMl ?? null) : null },
    (s) => onStage(s === 'bottle' ? 'bottle' : s === 'notes' ? 'notes' : s === 'images' ? 'images' : 'search'),
  );

  // 6. Confiança na identidade.
  let confidence = 0;
  if (input.identity?.name) confidence += 0.45;
  if (fromCatalog) confidence += fromCatalog.ambiguous ? 0.15 : 0.25;
  if (fromPage) confidence += 0.45;
  else if (clue.guess.name && nameSimilarity(name, clue.guess.name, brand) >= 0.72) confidence += 0.2;
  if (research.fragrantica) {
    confidence += 0.3;
    evidence.push(`base de perfumes: ${research.fragrantica.url}`);
  }
  if (research.stores.some((s) => s.official)) {
    confidence += 0.3;
    evidence.push(`loja oficial: ${research.stores.find((s) => s.official)!.product.url}`);
  }
  confidence += Math.min(0.24, agreeing.length * 0.06);
  if (pageFacts.length) confidence += 0.1;
  if (fromPage && research.fragrantica && nameSimilarity(fromPage.name, research.fragrantica.name, brand) < 0.5) confidence -= 0.2;
  confidence = Math.max(0, Math.min(1, confidence));
  if (confidence < 0.45) {
    return {
      ok: false,
      reason: 'unidentified',
      message: 'Não conseguimos identificar este perfume com segurança.',
      guess: { brand, name, concentration },
      evidence: [...evidence, `confiança ${Math.round(confidence * 100)}%`],
    };
  }

  // 7. Cada campo com a sua origem (prioridades do produto: oficial → loja do link → revendedora → base → busca).
  const official = research.stores.find((s) => s.official);
  fieldSources.name = fromCatalog ? src('database', 'Parfumo (catálogo da marca)', fromCatalog.url) : src(idKind, idKind === 'page' ? clue.host : idKind === 'user' ? 'você' : 'endereço do link', idKind === 'page' ? clue.original : null);
  fieldSources.brand = official ? src('official', official.product.store, official.product.url) : research.fragrantica ? src('database', 'base de perfumes', research.fragrantica.url) : fieldSources.name;

  const allText = [page.draft?.name, official?.product.title, ...pageFacts.map((f) => f.draft.name), research.fragrantica?.name].filter(Boolean).join(' ');
  const finalConcentration = concentration ?? detectConcentration(allText);
  if (finalConcentration) fieldSources.concentration = concentration ? fieldSources.name : src('search', 'outras fontes', null);
  // Tamanho: o da variante manda (é o objeto real); sem variantes, o que página/endereço/lojas dizem.
  const volume = variant?.volume ?? input.identity?.volume ?? page.draft?.volume ?? clue.guess.volume ?? detectVolume(official?.product.title ?? '') ?? pageFacts.map((f) => f.draft.volume).find(Boolean) ?? null;
  if (volume) fieldSources.volume = variant?.volume && variantSource ? src(variantSource.kind, variantSource.label, variantSource.url) : page.draft?.volume ? src('page', clue.host, clue.original) : src('search', 'outras fontes', null);

  // Preço: o da loja do link vale mais (é onde a pessoa quer comprar); senão, o de outra loja, com a origem dita.
  let price: ResolvedProduct['price'] = null;
  if (variant && variants.length > 1) {
    // Com variantes, o preço é SEMPRE o da variante escolhida — nunca o "a partir de" da página.
    if (variant.price != null && variant.currency) {
      price = { value: variant.price, currency: variant.currency };
      if (variantSource) fieldSources.price = src(variantSource.kind, variantSource.label, variantSource.url);
    }
  } else if (page.draft?.price != null && page.draft.currency) {
    price = { value: page.draft.price, currency: page.draft.currency };
    fieldSources.price = src('page', clue.host, clue.original);
  } else {
    const other = pageFacts.find((f) => f.draft.price != null && f.draft.currency);
    if (other) {
      price = { value: other.draft.price!, currency: other.draft.currency! };
      fieldSources.price = src('retailer', new URL(other.url).hostname.replace(/^www\./, ''), other.url);
    }
  }
  // A loja do link não deu preço (bloqueou ou não publica): a página da loja OFICIAL costuma dar — com a origem dita.
  let finalVolume = volume;
  if ((!price || !finalVolume) && official && !(variants.length > 1)) {
    const officialPage = await readPage(official.product.url);
    const d = officialPage.draft;
    if (!price && d?.price != null && d.currency) {
      price = { value: d.price, currency: d.currency };
      fieldSources.price = src('official', official.product.store, official.product.url);
    }
    const single = official.product.variants?.length === 1 ? official.product.variants[0].volume : null;
    if (!finalVolume && (d?.volume || single)) {
      finalVolume = d?.volume ?? single;
      fieldSources.volume = src('official', official.product.store, official.product.url);
    }
  }
  const description = page.draft?.description ?? pageFacts.map((f) => f.draft.description).find(Boolean) ?? null;
  const gender = page.draft?.gender ?? research.gender ?? clue.guess.gender ?? detectGender(allText);

  if (research.image) {
    const c = research.image.candidate;
    fieldSources.image = src(c.origin === 'brand' ? 'official' : c.origin === 'source' ? 'page' : c.origin === 'fragrantica' ? 'database' : c.origin === 'search' ? 'search' : 'retailer', c.label, c.pageUrl);
  }
  if (research.olfactoryProfile) {
    const p = research.olfactoryProfile;
    fieldSources.olfactoryProfile = src(/oficial/.test(p.source ?? '') ? 'official' : /Fragrantica|Parfumo/.test(p.source ?? '') ? 'database' : 'retailer', p.source ?? 'fonte', p.sourceUrl);
  }

  onStage('final');
  return {
    ok: true,
    product: {
      identity: { brand, name, concentration: finalConcentration, volume: finalVolume },
      confidence,
      // O catálogo achou mais de uma linha possível (Man × Woman): nunca entra sozinho — a pessoa confirma.
      level: confidence >= 0.75 && !fromCatalog?.ambiguous ? 'high' : 'moderate',
      gender,
      description,
      price,
      fieldSources,
      sourceUrl: clue.original,
      normalizedUrl: clue.normalized,
      pageBlocked: page.blocked,
      image: research.image,
      imageReport: research.imageReport,
      olfactoryProfile: research.olfactoryProfile,
      variant,
      variants,
      evidence: [...evidence, `confiança ${Math.round(confidence * 100)}%`],
    },
  };
}
