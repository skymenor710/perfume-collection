import { createHash } from 'node:crypto';
import { hexToRgb, rgbToOklab } from '@perfumes/core/color';
import { parseNotesText, sanitizeProfile, type OlfactoryProfile, type SourceRef } from '@perfumes/core/olfactory';
import type { Gender } from '@perfumes/core/perfume';
import { upgradeImageUrl } from '../import/extract';
import { type ProcessedBottle } from '../media/process';
import { processBottleOffThread as processBottleImage } from '../media/offthread';
import { waitTurn } from '../net/polite';
import { safeFetchImage } from '../net/safe-fetch';
import { findOnFragrantica, type FragranticaPerfume } from './fragrantica';
import { findOnParfumo } from './parfumo';
import { findInStores, type StoreMatch } from './stores';

/**
 * Pesquisa de um perfume já identificado (marca + nome): fotos candidatas de várias fontes, a melhor delas
 * recortada e normalizada, e o perfil olfativo com fonte. Usado ao adicionar por link, ao "pesquisar de novo"
 * e na migração da coleção existente — o mesmo caminho para todos.
 */

export type ImageOrigin = 'brand' | 'fragrantica' | 'retailer' | 'source' | 'search';

export interface ImageCandidate {
  url: string;
  origin: ImageOrigin;
  pageUrl: string;
  label: string;
  /** A foto da própria variante escolhida (a loja liga foto e variante): é o produto exato. */
  exact?: boolean;
  /** Tamanho do frasco na foto, quando a fonte diz (foto ligada a uma variante de loja). */
  sizeMl?: number | null;
}

export interface ChosenImage {
  bottle: ProcessedBottle;
  candidate: ImageCandidate;
  score: number;
}

export interface ResearchInput {
  brand: string;
  name: string;
  concentration?: string | null;
  /** Imagens da página do link (o produto exato), quando a página abriu. */
  pageImages?: string[];
  pageUrl?: string | null;
  /** Candidatas achadas por outras fontes (busca na internet, páginas de revendedoras). */
  extraImages?: ImageCandidate[];
  /** Tamanho da variante escolhida: foto de outro tamanho é outro frasco (Reflection 50 ml × 100 ml). */
  wantedMl?: number | null;
}

export interface ResearchResult {
  canonicalName: string | null;
  fragrantica: FragranticaPerfume | null;
  stores: StoreMatch[];
  image: ChosenImage | null;
  imageReport: { url: string; origin: ImageOrigin; score: number; reasons: string[] }[];
  olfactoryProfile: OlfactoryProfile | null;
  gender: Gender | null;
  price: { value: number; store: string } | null;
}

export type ResearchStage = 'info' | 'images' | 'bottle' | 'color' | 'notes';

const ORIGIN_BONUS: Record<ImageOrigin, number> = { brand: 10, source: 5, retailer: 3, fragrantica: 0, search: 0 };

interface ColorRef {
  hex: string;
  neutral: boolean;
  coverage: number;
  aspect?: number;
}

/**
 * A candidata tem a mesma "cara" da foto de referência (o produto exato)? Pega variantes de outra cor
 * (Precieux I preto × Precieux IV dourado) e fotos com enfeites coloridos em volta de um frasco neutro.
 */
function colorMismatch(ref: ColorRef, cand: ColorRef): boolean {
  const x = rgbToOklab(hexToRgb(ref.hex));
  const y = rgbToOklab(hexToRgb(cand.hex));
  if (Math.abs(x.L - y.L) > 0.35) return true;
  if (!ref.neutral && !cand.neutral) return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) > 0.16;
  if (ref.neutral && !cand.neutral) return Math.hypot(y.a, y.b) > 0.06;
  if (!ref.neutral && cand.neutral) return ref.coverage > 0.2;
  return false;
}

/** Defeitos que o recorte por IA costuma resolver: não servem para descartar uma candidata na triagem. */
const FIXABLE = /sombra|halo|contorno irregular|brilho|névoa|fundo escuro|comeu parte|buracos/;

interface Downloaded {
  candidate: ImageCandidate;
  buffer: Buffer;
  pre: number;
}

/**
 * Baixa as candidatas, tria todas com o recorte rápido (sem IA) e roda o processamento completo (com IA) só nas
 * três mais promissoras. Pontua origem, PNG transparente de verdade, cor e silhueta contra o produto exato.
 */
export async function chooseBestImage(candidates: ImageCandidate[], onStage: (s: ResearchStage) => void = () => {}, wantedMl: number | null = null) {
  const hasExact = candidates.some((c) => c.exact);
  const report: ResearchResult['imageReport'] = [];
  const done: ChosenImage[] = [];
  let reference: (ColorRef & { aspect: number }) | null = null;
  const seen = new Set<string>();
  const contents = new Set<string>();
  const pool: Downloaded[] = [];

  const judge = (candidate: ImageCandidate, bottle: ProcessedBottle) => {
    // A preferência pela fonte (oficial primeiro) só desempata fotos sem defeito; não salva foto ruim.
    const clean = bottle.quality.reasons.length === 0;
    let score =
      bottle.quality.score +
      (clean ? ORIGIN_BONUS[candidate.origin] : 0) +
      (clean && bottle.method === 'alpha' ? 6 : 0) +
      (clean && candidate.exact ? 12 : 0) +
      (clean && wantedMl !== null && candidate.sizeMl === wantedMl ? 6 : 0);
    const reasons = [...bottle.quality.reasons];
    // Foto de outro tamanho da mesma linha é OUTRO frasco: reprovada, por melhor que seja.
    if (wantedMl !== null && candidate.sizeMl && candidate.sizeMl !== wantedMl) {
      score -= 40;
      reasons.push(`foto de outro tamanho (${candidate.sizeMl} ml, não ${wantedMl} ml)`);
    }
    // Referência contra variantes: a foto da variante escolhida, quando existe; senão a da página ou da base.
    const isReference = !reference && (hasExact ? Boolean(candidate.exact) : candidate.origin === 'source' || candidate.origin === 'fragrantica') && bottle.cutout;
    if (isReference) reference = { ...bottle.color, aspect: bottle.quality.metrics.aspect };
    if (reference && !isReference && colorMismatch(reference, bottle.color)) {
      score -= 25;
      reasons.push('cor diferente da referência (outra versão?)');
    }
    // Silhueta bem mais larga que a do produto de referência: há algo junto do frasco (caixa, frutas, flores).
    if (reference && !isReference && bottle.quality.metrics.aspect - reference.aspect > 0.22) {
      score -= 25;
      reasons.push('silhueta mais larga que a do produto (objetos junto)');
    }
    return { score, reasons };
  };

  // 1ª passada: baixar e triar (rápido).
  for (const raw of candidates) {
    const candidate = { ...raw, sizeMl: raw.sizeMl ?? sizeFromFilename(raw.url) };
    const url = upgradeImageUrl(candidate.url);
    if (seen.has(url) || seen.size >= 12) continue;
    seen.add(url);
    try {
      await waitTurn(new URL(url).host);
      const image = await safeFetchImage(url, { timeoutMs: 15_000, maxBytes: 20 * 1024 * 1024 });
      // A mesma foto servida por várias lojas (endereços diferentes, bytes iguais) conta uma vez só.
      const digest = createHash('sha1').update(image.buffer).digest('hex');
      if (contents.has(digest)) {
        report.push({ url, origin: candidate.origin, score: 0, reasons: ['mesma foto de outra fonte (já avaliada)'] });
        continue;
      }
      contents.add(digest);
      const quick = await processBottleImage(image.buffer, { noAi: true });
      const { score, reasons } = judge({ ...candidate, url }, quick);
      const structural = reasons.filter((r) => !FIXABLE.test(r));
      // Nota da triagem: o que a IA não conserta (frasco cortado, caixa, pessoa, variante errada) pesa inteiro.
      const pre = score + (reasons.length - structural.length) * 18;
      pool.push({ candidate: { ...candidate, url }, buffer: image.buffer, pre });
    } catch (error) {
      report.push({ url, origin: candidate.origin, score: 0, reasons: [`não baixou (${(error as Error).message.slice(0, 60)})`] });
    }
  }

  // 2ª passada — laço de controle de qualidade: processamento completo na ordem da triagem. As cinco mais
  // promissoras sempre são comparadas; se nenhuma passar, segue para a próxima fonte até uma passar ou a lista
  // acabar. Foto ruim não é "salva" à força: outra fonte vale mais, e nenhuma foto vale mais que uma ruim.
  onStage('bottle');
  pool.sort((a, b) => b.pre - a.pre);
  let processed = 0;
  for (const item of pool) {
    // Para quando já há foto aprovada, cinco foram comparadas e nenhuma das restantes tem nota de triagem capaz de
    // passar a melhor (a triagem sem IA erra para menos, por isso a folga de 10).
    const best = done.reduce((m, d) => Math.max(m, d.score), -Infinity);
    if (processed >= 5 && done.length > 0 && item.pre + 10 <= best) {
      report.push({ url: item.candidate.url, origin: item.candidate.origin, score: Math.round(item.pre), reasons: ['triagem: sem chance de passar a foto aprovada'] });
      continue;
    }
    processed++;
    try {
      const bottle = await processBottleImage(item.buffer);
      const { score, reasons } = judge(item.candidate, bottle);
      const passed = bottle.quality.accepted && !reasons.some((r) => /outro tamanho/.test(r));
      report.push({ url: item.candidate.url, origin: item.candidate.origin, score, reasons: [`[${bottle.method}]`, ...(passed ? [] : ['REPROVADA']), ...reasons] });
      if (passed) done.push({ bottle, candidate: item.candidate, score });
    } catch (error) {
      report.push({ url: item.candidate.url, origin: item.candidate.origin, score: 0, reasons: [`não processou (${(error as Error).message.slice(0, 60)})`] });
    }
  }
  done.sort((a, b) => b.score - a.score);
  return { chosen: done[0] ?? null, report };
}

/**
 * Tamanho escrito no nome do arquivo da foto ("empire_100ml_sku_1.jpg"), quando a fonte não liga foto e variante.
 * Só vale se o nome cita UM tamanho: "reflection-50ml100ml-…" cita dois e não diz nada.
 */
export function sizeFromFilename(url: string): number | null {
  let file: string;
  try {
    file = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return null;
  }
  const sizes = [...new Set([...file.matchAll(/(?<![0-9])(\d{2,3})\s*ml/gi)].map((m) => Number(m[1])))];
  return sizes.length === 1 ? sizes[0] : null;
}

function storeCandidates(matches: StoreMatch[], wantedMl: number | null = null): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  for (const m of matches) {
    const sizeOf = new Map((m.product.variants ?? []).map((v) => [v.id, v.volumeMl]));
    const tagged = m.product.images.map((img) => {
      const sizes = [...new Set((img.variantIds ?? []).map((id) => sizeOf.get(id)).filter((x): x is number => typeof x === 'number'))];
      return { img, sizeMl: sizes.length === 1 ? sizes[0] : sizeFromFilename(img.src) };
    });
    // Com tamanho escolhido: primeiro as fotos ligadas a ele, depois as sem tamanho; as de outro tamanho nem entram.
    const usable = wantedMl === null ? tagged : [...tagged.filter((t) => t.sizeMl === wantedMl), ...tagged.filter((t) => t.sizeMl === null)];
    // As três primeiras de cada produto: a de frente costuma ser a primeira; as outras são caixa/ambiente.
    for (const { img, sizeMl } of usable.slice(0, 3)) {
      out.push({ url: img.src, origin: m.official ? 'brand' : 'retailer', pageUrl: m.product.url, label: `${m.product.store} · ${m.product.title}`, sizeMl });
    }
  }
  return out;
}

export async function researchPerfume(input: ResearchInput, onStage: (s: ResearchStage) => void = () => {}): Promise<ResearchResult> {
  onStage('info');
  const hints = [input.concentration ?? ''];
  const sourceHost = input.pageUrl ? new URL(input.pageUrl).hostname.replace(/^www\./, '') : null;
  const [fromFragrantica, stores] = await Promise.all([
    findOnFragrantica(input.brand, input.name, hints).catch(() => null),
    findInStores(input.brand, input.name, sourceHost, input.concentration).catch(() => [] as StoreMatch[]),
  ]);
  // Base de perfumes: Fragrantica quando acessível; senão Parfumo (mesmo formato de resultado).
  const fragrantica = fromFragrantica ?? (await findOnParfumo(input.brand, input.name, hints).catch(() => null));
  const dbName = fromFragrantica ? 'Fragrantica' : 'Parfumo';

  onStage('images');
  const official = stores.filter((s) => s.official);
  const retail = stores.filter((s) => !s.official);
  const candidates: ImageCandidate[] = [
    ...storeCandidates(official, input.wantedMl ?? null),
    ...(input.pageImages ?? []).slice(0, 3).map((url) => ({ url, origin: 'source' as const, pageUrl: input.pageUrl ?? url, label: 'página do link' })),
    ...(fragrantica?.image ? [{ url: fragrantica.image, origin: 'fragrantica' as const, pageUrl: fragrantica.url, label: dbName }] : []),
    ...storeCandidates(retail, input.wantedMl ?? null),
    ...(input.extraImages ?? []),
  ];
  // Referência de cor primeiro: a foto do produto exato entra antes na fila de avaliação.
  // A foto exata da variante vem antes de todas (é a referência); depois página e base; depois o resto.
  const rank = (c: ImageCandidate) => (c.exact ? 0 : c.origin === 'source' || c.origin === 'fragrantica' ? 1 : 2);
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  const { chosen, report } = await chooseBestImage(ordered, onStage, input.wantedMl ?? null);
  onStage('color');

  onStage('notes');
  const sources: SourceRef[] = [];
  let pyramid: ReturnType<typeof parseNotesText> = null;
  let pyramidSource: SourceRef | null = null;
  // Prioridade: site oficial da marca → base de perfumes (Fragrantica/Parfumo) → revendedora.
  const fromStore = (matches: StoreMatch[]) => {
    for (const m of matches) {
      const parsed = parseNotesText(m.product.bodyHtml);
      if (parsed) return { parsed, ref: { name: m.official ? `${m.product.store} (oficial)` : m.product.store, url: m.product.url } };
    }
    return null;
  };
  const officialNotes = fromStore(official);
  if (officialNotes) {
    pyramid = officialNotes.parsed;
    pyramidSource = officialNotes.ref;
  } else if (fragrantica && (fragrantica.topNotes.length || fragrantica.heartNotes.length || fragrantica.baseNotes.length)) {
    pyramid = { topNotes: fragrantica.topNotes, heartNotes: fragrantica.heartNotes, baseNotes: fragrantica.baseNotes };
    pyramidSource = { name: dbName, url: fragrantica.url };
  } else if (!fragrantica?.notes.length) {
    const retailNotes = fromStore(retail);
    if (retailNotes) {
      pyramid = retailNotes.parsed;
      pyramidSource = retailNotes.ref;
    }
  }
  if (pyramidSource) sources.push(pyramidSource);
  if (fragrantica && !sources.some((s) => s.url === fragrantica.url)) sources.push({ name: dbName, url: fragrantica.url });

  const olfactoryProfile = sanitizeProfile({
    ...(pyramid ?? {}),
    notes: pyramid ? [] : (fragrantica?.notes ?? []),
    mainAccords: fragrantica?.mainAccords ?? [],
    fragranceFamily: fragrantica?.fragranceFamily ?? null,
    perfumer: fragrantica?.perfumer ?? null,
    releaseYear: fragrantica?.releaseYear ?? null,
    source: pyramidSource?.name ?? (fragrantica ? dbName : null),
    sourceUrl: pyramidSource?.url ?? fragrantica?.url ?? null,
    sources,
    lastUpdated: new Date().toISOString(),
  });

  const priced = official.find((m) => m.product.price !== null);
  return {
    canonicalName: fragrantica?.name ?? official[0]?.product.title ?? null,
    fragrantica,
    stores,
    image: chosen,
    imageReport: report,
    olfactoryProfile,
    gender: fragrantica?.gender ?? null,
    price: priced?.product.price ? { value: priced.product.price, store: priced.product.store } : null,
  };
}
