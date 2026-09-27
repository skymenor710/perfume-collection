import sharp from 'sharp';
import { BOTTLE_CANVAS, placeInCanvas } from '../../src/core/canvas';
import { dominantColor, rgbToOklab, type DominantColor } from '../../src/core/color';
import { opaqueBounds, removeBackground, type CutoutOptions } from '../../src/core/cutout';
import { assessCutout, type QualityReport } from '../../src/core/quality';
import { predictMask } from './matting';

/**
 * Foto de produto (JPG, WebP, PNG, AVIF…) → frasco isolado, pronto para o palco:
 *
 *   1. se a foto já tem alfa de verdade (PNG recortado), ele é usado — e avaliado como qualquer outro;
 *   2. senão, dois recortes independentes: por cor (inundação a partir das bordas, ótimo em fundo liso) e por IA
 *      (BiRefNet: separa objeto de sombra, reflexo de estúdio, fundo de campanha);
 *   3. FUSÃO: a máscara da IA é a base; o que só o recorte por cor manteve volta se tiver cara de objeto
 *      (cor, escuro, metal) e fica de fora se tiver cara de sombra ou resto de fundo (cinza claro sem cor);
 *   4. cada variante (cor, IA, fusão) passa pela avaliação de qualidade e a melhor segue;
 *   5. contorno refinado, corte no frasco e NORMALIZAÇÃO num quadro quadrado 2048 × 2048 transparente:
 *      frasco centrado na horizontal, base sempre na mesma linha (92%), cabendo em 72% × 84% do quadro;
 *   6. mestre em PNG (o arquivo guardado) + derivados WebP com alfa para exibir (palco e vizinhos).
 */

export interface ProcessedBottle {
  /** Mestre: PNG 2048×2048 com fundo transparente. */
  master: Buffer;
  large: Buffer;
  small: Buffer;
  width: number;
  height: number;
  color: DominantColor;
  /** O fundo foi removido (ou a foto já vinha recortada). */
  cutout: boolean;
  /** Como o frasco foi isolado. */
  method: 'alpha' | 'color' | 'ai' | 'fusion' | 'none';
  quality: QualityReport;
}

export const CANVAS = BOTTLE_CANVAS.size;
export const LARGE = 1024;
export const SMALL = 384;
/** Linha do "piso" no quadro (fração da altura): o palco alinha reflexo e luz por ela. */
export const BASELINE = BOTTLE_CANVAS.baseline;
const WORK_SIZE = 1400;

export interface ProcessOptions extends CutoutOptions {
  /** Recorte prévio [x, y, largura, altura] em frações da foto. */
  region?: [number, number, number, number];
  /** Sem IA (testes, ou quando o modelo não pode ser usado). */
  noAi?: boolean;
}

interface Variant {
  method: ProcessedBottle['method'];
  pixels: Uint8ClampedArray;
  removed: boolean;
  quality: QualityReport;
}

function hasRealAlpha(data: Uint8Array | Uint8ClampedArray, w: number, h: number, minShare = 0.6) {
  let transparent = 0;
  let border = 0;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      border++;
      if (data[(y * w + x) * 4 + 3] < 16) transparent++;
    }
  }
  return border > 0 && transparent / border > minShare;
}

/**
 * Borda macia sem franja: num pixel meio transparente, a cor observada é mistura do frasco com o fundo.
 * Tira o fundo da mistura — c = (observado − fundo·(1−α)) / α — para não sobrar halo claro sobre o preto.
 */
function decontaminate(px: Uint8ClampedArray, w: number, h: number, bg: { r: number; g: number; b: number }) {
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const a = px[i + 3] / 255;
    if (a <= 0.02 || a >= 0.98) continue;
    px[i] = (px[i] - bg.r * (1 - a)) / a;
    px[i + 1] = (px[i + 1] - bg.g * (1 - a)) / a;
    px[i + 2] = (px[i + 2] - bg.b * (1 - a)) / a;
  }
  return px;
}

/**
 * A IA às vezes "inventa" uma névoa sobre o fundo liso (o fantasma branco acima da tampa do Spectre Ghost).
 * Cor sozinha não separa névoa de frasco branco no branco (Zefiro): nos dois casos o pixel é igual ao fundo e a IA
 * tem certeza. O que separa é a EVIDÊNCIA NA FOTO: o contorno de um frasco de verdade — mesmo branco no branco —
 * tem sombreado ou linha na imagem original; o contorno de uma névoa inventada fica em fundo liso, sem nada.
 *
 * Então: as regiões candidatas (IA diz objeto, recorte por cor diz fundo, cor ≈ fundo) viram componentes; para cada
 * uma, mede-se quanto do contorno EXTERNO dela (a borda com o fundo de verdade) tem gradiente na foto. Pouco apoio =
 * névoa, sai. Apoio = frasco, fica. Região sem contorno externo (miolo do vidro) sempre fica.
 */
/**
 * Mapa de bordas da foto original: gradiente (Sobel) da luminância, com o máximo numa vizinhança 5×5 — um contorno
 * de recorte pode passar um ou dois pixels fora da linha real. Serve para duas perguntas: "a névoa tem borda na
 * foto?" e "o corte final passa por bordas de verdade?".
 */
function edgeMap(original: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0; p < n; p++) lum[p] = 0.2126 * original[p * 4] + 0.7152 * original[p * 4 + 1] + 0.0722 * original[p * 4 + 2];
  const grad = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = lum[p - w + 1] + 2 * lum[p + 1] + lum[p + w + 1] - lum[p - w - 1] - 2 * lum[p - 1] - lum[p + w - 1];
      const gy = lum[p + w - 1] + 2 * lum[p + w] + lum[p + w + 1] - lum[p - w - 1] - 2 * lum[p - w] - lum[p - w + 1];
      grad[p] = Math.hypot(gx, gy) / 4;
    }
  const near = new Float32Array(n);
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.max(m, grad[(y + dy) * w + x + dx]);
      near[y * w + x] = m;
    }
  return near;
}

/**
 * Quanto do contorno do recorte passa por bordas reais da foto (0–1). Corte certo segue a linha do frasco; corte
 * que "mordeu" um frasco branco no branco atravessa vidro liso, onde a foto não tem borda nenhuma.
 */
function edgeSupport(pixels: Uint8ClampedArray, near: Float32Array, w: number, h: number): number {
  let border = 0;
  let supported = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (pixels[p * 4 + 3] < 128) continue;
      if (pixels[(p - 1) * 4 + 3] >= 128 && pixels[(p + 1) * 4 + 3] >= 128 && pixels[(p - w) * 4 + 3] >= 128 && pixels[(p + w) * 4 + 3] >= 128) continue;
      border++;
      if (near[p] > 5) supported++;
    }
  return border ? supported / border : 1;
}

function groundMask(mask: Uint8Array, original: Uint8ClampedArray, colorCut: Uint8ClampedArray, bg: { r: number; g: number; b: number }, w: number, h: number, near: Float32Array) {
  const bgLab = rgbToOklab(bg);
  const n = w * h;

  const candidate = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (mask[p] < 32 || colorCut[p * 4 + 3] >= 50) continue;
    const i = p * 4;
    const lab = rgbToOklab({ r: original[i], g: original[i + 1], b: original[i + 2] });
    if (Math.hypot(lab.L - bgLab.L, lab.a - bgLab.a, lab.b - bgLab.b) < 0.03) candidate[p] = 1;
  }

  const out = new Uint8Array(mask);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  let cleared = 0;
  let kept = 0;
  for (let start = 0; start < n; start++) {
    if (!candidate[start] || seen[start]) continue;
    const region: number[] = [];
    let border = 0;
    let supported = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      const x = p % w;
      const y = (p - x) / w;
      let outer = false;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0) {
          outer = true;
          continue;
        }
        if (mask[q] < 32) outer = true; // vizinho é fundo segundo a IA: este pixel está no contorno externo
        if (candidate[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
      if (outer) {
        border++;
        if (near[p] > 5) supported++;
      }
    }
    // Sem contorno externo (miolo do vidro) ou contorno com linha na foto: é frasco.
    if (border < 8 || supported / border >= 0.35) {
      kept += region.length;
      continue;
    }
    for (const p of region) out[p] = 0;
    cleared += region.length;
  }
  return { mask: out, cleared, kept };
}

/** Máscara da IA + de volta o que o recorte por cor viu como objeto (e não como sombra). */
function fuse(base: Uint8ClampedArray, colorCut: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) {
  const out = new Uint8ClampedArray(base);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    let a = mask[p];
    if (a < 128 && colorCut[i + 3] > 200) {
      const lab = rgbToOklab({ r: base[i], g: base[i + 1], b: base[i + 2] });
      const shadowLike = lab.L > 0.72 && Math.hypot(lab.a, lab.b) < 0.035;
      if (!shadowLike) a = colorCut[i + 3];
    }
    out[i + 3] = Math.min(base[i + 3], a);
  }
  return out;
}

export async function processBottleImage(input: Buffer, options: ProcessOptions = {}): Promise<ProcessedBottle> {
  const meta = await sharp(input, { limitInputPixels: 80_000_000 }).rotate().metadata();
  const srcW = meta.autoOrient?.width ?? meta.width ?? 0;
  const srcH = meta.autoOrient?.height ?? meta.height ?? 0;
  let source = sharp(input, { limitInputPixels: 80_000_000 }).rotate();
  let effectiveH = srcH;
  // PNG já recortado costuma vir cortado rente ao frasco: uma margem transparente evita que isso pareça
  // "frasco cortado pela borda" na avaliação.
  const probe = meta.hasAlpha ? await sharp(input).rotate().resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null;
  if (probe && hasRealAlpha(probe.data, probe.info.width, probe.info.height, 0.2)) {
    const pad = Math.round(Math.max(srcW, srcH) * 0.04);
    source = sharp(await source.extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  }
  if (options.region) {
    const [rx, ry, rw, rh] = options.region;
    source = sharp(await source.extract({ left: Math.round(rx * srcW), top: Math.round(ry * srcH), width: Math.round(rw * srcW), height: Math.round(rh * srcH) }).toBuffer());
    effectiveH = Math.round(rh * srcH);
  }
  const { data, info } = await source.resize(WORK_SIZE, WORK_SIZE, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const original = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);

  const variants: Variant[] = [];
  const near = edgeMap(original, W, H);
  const assess = (method: Variant['method'], pixels: Uint8ClampedArray, removed: boolean, background: { r: number; g: number; b: number } | null) => {
    let quality = assessCutout(pixels, W, H, removed, effectiveH, background, method === 'ai' || method === 'fusion');
    // Contorno sem borda na foto = recorte que mordeu o frasco (ou deixou fundo grudado). Não vale para PNG que já
    // veio recortado: atrás do alfa, a cor original é qualquer coisa.
    if (removed && method !== 'alpha') {
      const support = edgeSupport(pixels, near, W, H);
      // Calibrado: recortes certos ficam em 0,97–1,00 (inclusive branco no branco); o Zefiro mordido, em 0,80.
      const cut = support < 0.85 ? 30 : support < 0.92 ? 12 : 0;
      quality = {
        ...quality,
        metrics: { ...quality.metrics, edgeSupport: Math.round(support * 100) / 100 },
        ...(cut ? { score: Math.max(0, quality.score - cut), reasons: [...quality.reasons, 'contorno fora da borda real do frasco (recorte mordeu ou deixou fundo)'] } : {}),
      };
      quality.accepted = quality.accepted && quality.score >= 45 && support >= 0.85;
    }
    variants.push({ method, pixels, removed, quality });
  };

  if (hasRealAlpha(original, W, H)) {
    assess('alpha', new Uint8ClampedArray(original), true, null);
  }
  // Recorte por cor, com tolerância normal e apertada (frasco claro sobre branco perde a borda na normal).
  let colorCut: Uint8ClampedArray | null = null;
  let colorScore = -1;
  let background: { r: number; g: number; b: number } | null = null;
  for (const tolerance of options.tolerance !== undefined ? [options.tolerance] : [undefined, 3.5]) {
    const px = new Uint8ClampedArray(original);
    const cut = removeBackground(px, W, H, { ...options, tolerance });
    if (!cut.removed) continue;
    background = cut.background;
    assess('color', px, true, cut.background);
    const score = variants[variants.length - 1].quality.score;
    if (score > colorScore) {
      colorScore = score;
      colorCut = px;
    }
  }

  if (!options.noAi) {
    const raw = await predictMask(original, W, H).catch(() => null);
    const grounded = raw && colorCut && background ? groundMask(raw, original, colorCut, background, W, H, near) : null;
    if (process.env.DEBUG_CUTOUT && grounded) console.log(`  [ai] névoa sem evidência removida: ${grounded.cleared} px (mantidos por evidência: ${grounded.kept} px)`);
    const mask = grounded?.mask ?? raw;
    if (mask) {
      const ai = new Uint8ClampedArray(original);
      for (let p = 0; p < W * H; p++) ai[p * 4 + 3] = Math.min(ai[p * 4 + 3], mask[p]);
      const bgForEdges = background ?? { r: 255, g: 255, b: 255 };
      assess('ai', decontaminate(ai, W, H, bgForEdges), true, background);
      if (colorCut) {
        assess('fusion', decontaminate(fuse(original, colorCut, mask, W, H), W, H, bgForEdges), true, background);
        // Segunda opinião: o que o recorte por cor manteve e a IA descartou, se for claro e sem cor, é sombra de
        // estúdio ou resto de fundo grudado no frasco — o recorte por cor perde pontos por isso.
        let kept = 0;
        let shadow = 0;
        let aiArea = 0;
        let eaten = 0;
        for (let p = 0; p < W * H; p++) {
          const i = p * 4;
          if (mask[p] > 200) {
            aiArea++;
            if (colorCut[i + 3] < 50) eaten++;
          }
          if (colorCut[i + 3] <= 200) continue;
          kept++;
          if (mask[p] >= 128) continue;
          const lab = rgbToOklab({ r: original[i], g: original[i + 1], b: original[i + 2] });
          if (lab.L > 0.6 && Math.hypot(lab.a, lab.b) < 0.035) shadow++;
        }
        const penalize = (points: number, reason: string) => {
          for (const v of variants) {
            if (v.method !== 'color') continue;
            v.quality = { ...v.quality, score: Math.max(0, v.quality.score - points), reasons: [...v.quality.reasons, reason] };
            v.quality.accepted = v.quality.score >= 45 && v.quality.accepted;
          }
        };
        if (kept && shadow / kept > 0.035) penalize(30, 'sombra ou resto de fundo junto do frasco');
        // O inverso: a IA vê frasco onde o recorte por cor apagou (metal claro, vidro fosco) — a "mordida".
        if (aiArea && eaten / aiArea > 0.02) penalize(20, 'recorte por cor comeu parte do frasco');
      }
    }
  }
  if (!variants.length) assess('none', new Uint8ClampedArray(original), false, null);

  // Desempate a favor da IA/fusão: com a mesma nota, elas tiram sombra e reflexo que a nota não enxerga.
  const rank = { fusion: 3, ai: 2, alpha: 2, color: 1, none: 0 } as const;
  variants.sort((a, b) => b.quality.score - a.quality.score || rank[b.method] - rank[a.method]);
  if (process.env.DEBUG_CUTOUT) for (const v of variants) console.log(`  [${v.method}] ${v.quality.score} apoio=${v.quality.metrics.edgeSupport ?? "-"} ${JSON.stringify(v.quality.metrics).slice(0, 0)} ${v.quality.reasons.join("; ")}`);
  const best = variants[0];
  const { pixels, removed, quality } = best;

  const box = (removed && opaqueBounds(pixels, W, H, 0.002)) || { x: 0, y: 0, width: W, height: H };
  let png = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .png()
    .toBuffer();
  if (removed) {
    // Contorno limpo: só o alfa passa por um desfoque sutil e uma curva que "aperta" a borda.
    const rgb = await sharp(png).removeAlpha().toBuffer();
    const alpha = await sharp(png).extractChannel('alpha').blur(0.7).linear(1.3, -0.3 * 255).toBuffer();
    png = await sharp(rgb).joinChannel(alpha).png().toBuffer();
  }

  const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const color = dominantColor(raw.data, raw.info.width, raw.info.height, removed);

  // Quadro 2048² transparente: frasco em até 72% × 84%, centrado na horizontal, base na linha de 92%.
  const place = placeInCanvas(box.width, box.height, CANVAS);
  const bottle = await sharp(png).resize(place.width, place.height, { kernel: 'lanczos3' }).toBuffer();
  const master = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bottle, left: place.left, top: place.top }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const derive = (side: number, q: number) => sharp(master).resize(side, side, { kernel: 'lanczos3' }).webp({ quality: q, alphaQuality: 92, effort: 5, smartSubsample: true }).toBuffer();
  const [large, small] = await Promise.all([derive(LARGE, 86), derive(SMALL, 80)]);
  return { master, large, small, width: CANVAS, height: CANVAS, color, cutout: removed, method: best.method, quality };
}
