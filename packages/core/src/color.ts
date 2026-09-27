/**
 * Cor em OKLab/OKLCH, sem dependências: roda no navegador (canvas) e no servidor (sharp).
 * OKLab é perceptual — misturar duas cores nele dá uma transição que o olho lê como contínua,
 * sem o "cinza sujo" do meio do caminho em RGB.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToLinear({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = ([r, g, b]: [number, number, number]) => [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005);

export function oklabToRgb(lab: Oklab): Rgb {
  // Fora do sRGB, reduz o croma mantendo luminosidade e matiz, em vez de cortar canal a canal.
  let lin = oklabToLinear(lab);
  if (!inGamut(lin)) {
    const { L, C, h } = oklabToOklch(lab);
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(oklchToOklab({ L, C: mid, h })))) lo = mid;
      else hi = mid;
    }
    lin = oklabToLinear(oklchToOklab({ L, C: lo, h }));
  }
  return { r: fromLinear(lin[0]), g: fromLinear(lin[1]), b: fromLinear(lin[2]) };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export const rgbToOklch = (rgb: Rgb) => oklabToOklch(rgbToOklab(rgb));
export const oklchToRgb = (lch: Oklch) => oklabToRgb(oklchToOklab(lch));

const HEX = /^#?([0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`Cor inválida: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function mixOklab(from: Oklab, to: Oklab, t: number): Oklab {
  return { L: from.L + (to.L - from.L) * t, a: from.a + (to.a - from.a) * t, b: from.b + (to.b - from.b) * t };
}

export interface DominantColor {
  /** A cor do frasco em si (média perceptual da família de matiz dominante). */
  hex: string;
  /** Frasco sem cor própria (vidro transparente, preto, branco, cromado). */
  neutral: boolean;
  /** Fração dos pixels do frasco que pertencem à cor escolhida. */
  coverage: number;
}

const BINS = 36;

/**
 * Cor dominante do produto, não do pixel mais comum.
 *
 * Só conta o que é frasco (alfa alto — o fundo já foi recortado) e, dentro dele, dá peso ao croma:
 * o branco do estúdio, o preto das sombras e os reflexos cinzentos do vidro não votam. Os pixels com cor
 * votam por matiz num histograma circular; a família vencedora vira a média OKLab dos seus pixels.
 * Se quase nada do frasco tem cor, a resposta é "neutro", com a luminosidade média — e a interface usa prata.
 */
export function dominantColor(data: ArrayLike<number>, width: number, height: number, hasAlpha = true): DominantColor {
  const total = width * height;
  const stride = Math.max(1, Math.floor(Math.sqrt(total / 60000)));
  const hist = new Float64Array(BINS);
  const sums = Array.from({ length: BINS }, () => ({ w: 0, L: 0, a: 0, b: 0, n: 0 }));
  let bottle = 0;
  let chromatic = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (hasAlpha && data[i + 3] < 200) continue;
      const lab = rgbToOklab({ r: data[i], g: data[i + 1], b: data[i + 2] });
      bottle++;
      sumL += lab.L;
      sumA += lab.a;
      sumB += lab.b;
      const C = Math.hypot(lab.a, lab.b);
      if (C < 0.04 || lab.L < 0.18 || lab.L > 0.97) continue;
      chromatic++;
      let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
      if (h < 0) h += 360;
      const bin = Math.floor(h / (360 / BINS)) % BINS;
      // Voto = croma × área: um líquido saturado ganha de um reflexo morno, e o corpo do frasco ganha de uma tampa dourada.
      const w = C;
      hist[bin] += w;
      const s = sums[bin];
      s.w += w;
      s.L += lab.L * w;
      s.a += lab.a * w;
      s.b += lab.b * w;
      s.n++;
    }
  }

  const avgNeutral = (): DominantColor => {
    const L = bottle ? sumL / bottle : 0.5;
    const a = bottle ? sumA / bottle : 0;
    const b = bottle ? sumB / bottle : 0;
    // Guarda só um traço do matiz médio (um preto azulado continua azulado), sem inventar cor.
    const C = Math.min(0.02, Math.hypot(a, b));
    const h = oklabToOklch({ L, a, b }).h;
    return { hex: rgbToHex(oklchToRgb({ L, C, h })), neutral: true, coverage: 0 };
  };

  if (!bottle || chromatic / bottle < 0.02) return avgNeutral();

  // Suaviza o histograma circular (janela de 3 bins = 30°) para achar a família, não o bin isolado.
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < BINS; k++) {
    const score = hist[(k + BINS - 1) % BINS] + hist[k] + hist[(k + 1) % BINS];
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }

  let w = 0;
  let L = 0;
  let a = 0;
  let b = 0;
  let n = 0;
  for (const k of [(best + BINS - 1) % BINS, best, (best + 1) % BINS]) {
    const s = sums[k];
    w += s.w;
    L += s.L;
    a += s.a;
    b += s.b;
    n += s.n;
  }
  const lab = { L: L / w, a: a / w, b: b / w };
  return { hex: rgbToHex(oklabToRgb(lab)), neutral: false, coverage: n / bottle };
}
