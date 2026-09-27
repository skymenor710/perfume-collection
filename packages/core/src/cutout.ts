/**
 * Recorte do fundo de foto de produto, em RGBA puro (navegador e servidor usam o mesmo código).
 *
 * Foto de loja de perfume quase sempre é o frasco num fundo liso (branco, cinza-claro, às vezes colorido).
 * O recorte parte das bordas e inunda só o que é parecido com a cor do fundo — o que está preso dentro do
 * frasco fica. A borda do frasco ganha alfa proporcional à distância da cor de fundo e tem a cor "descontaminada"
 * (sem o halo branco que apareceria sobre o preto do app).
 * Quando o fundo não é liso (foto de ambiente), não recorta: devolve `removed: false` e a imagem intacta.
 */

import { rgbToOklab, type Rgb } from './color';

export interface CutoutOptions {
  /** Distância OKLab (×100) até a qual um pixel da borda ainda é "fundo". */
  tolerance?: number;
  /** Largura da rampa de alfa depois da tolerância. */
  feather?: number;
  /**
   * Remove também bolsões de fundo presos dentro do contorno (o furo de uma alça, o vão sob a tampa).
   * Desligar para frascos brancos com rótulo branco, onde o "bolsão" é o próprio rótulo.
   */
  pockets?: boolean;
}

export interface CutoutResult {
  removed: boolean;
  background: Rgb | null;
  /** Fração da imagem que era fundo. */
  backgroundShare: number;
}

function labDistance(data: ArrayLike<number>, i: number, bg: { L: number; a: number; b: number }) {
  const lab = rgbToOklab({ r: data[i], g: data[i + 1], b: data[i + 2] });
  return Math.hypot(lab.L - bg.L, lab.a - bg.a, lab.b - bg.b) * 100;
}

function borderSample(data: ArrayLike<number>, width: number, height: number): Rgb[] {
  const out: Rgb[] = [];
  const step = Math.max(1, Math.floor((width + height) / 400));
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    out.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  };
  for (let x = 0; x < width; x += step) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    push(0, y);
    push(width - 1, y);
  }
  return out;
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Modifica `data` no lugar. */
export function removeBackground(data: Uint8ClampedArray | Uint8Array, width: number, height: number, options: CutoutOptions = {}): CutoutResult {
  const tolerance = options.tolerance ?? 7;
  const feather = options.feather ?? 9;
  const border = borderSample(data, width, height);

  // Já tem transparência de verdade (PNG recortado): não mexe.
  const transparentBorder = (() => {
    let t = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(width / 200));
    for (let x = 0; x < width; x += step) {
      n += 2;
      if (data[x * 4 + 3] < 16) t++;
      if (data[((height - 1) * width + x) * 4 + 3] < 16) t++;
    }
    return n > 0 && t / n > 0.6;
  })();
  if (transparentBorder) return { removed: true, background: null, backgroundShare: 0 };
  if (border.length < 8) return { removed: false, background: null, backgroundShare: 0 };

  const bgRgb = { r: median(border.map((p) => p.r)), g: median(border.map((p) => p.g)), b: median(border.map((p) => p.b)) };
  const bg = rgbToOklab(bgRgb);

  // Fundo liso? A maioria da borda precisa estar perto da mediana.
  const near = border.filter((p) => {
    const lab = rgbToOklab(p);
    return Math.hypot(lab.L - bg.L, lab.a - bg.a, lab.b - bg.b) * 100 < tolerance * 1.6;
  }).length;
  if (near / border.length < 0.55) return { removed: false, background: bgRgb, backgroundShare: 0 };

  const n = width * height;
  const dist = new Float32Array(n);
  for (let p = 0; p < n; p++) dist[p] = labDistance(data, p * 4, bg);

  const isBg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (p: number) => {
    if (!isBg[p] && dist[p] <= tolerance) {
      isBg[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (y > 0) seed(p - width);
    if (y < height - 1) seed(p + width);
  }

  // Bolsões de fundo presos (entre a tampa e o frasco, dentro de alças): mesma cor exata do fundo,
  // com área razoável, também saem. Um pixel isolado branco no vidro fica.
  const visited = new Uint8Array(n);
  const minPocket = Math.max(60, Math.floor(n * 0.0006));
  const pocket: number[] = [];
  const pockets: number[][] = [];
  for (let start = 0; options.pockets !== false && start < n; start++) {
    if (isBg[start] || visited[start] || dist[start] > tolerance * 0.55) continue;
    pocket.length = 0;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const p = queue[head++];
      pocket.push(p);
      const x = p % width;
      const nbs = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of nbs) {
        if (q < 0 || q >= n || visited[q] || isBg[q] || dist[q] > tolerance * 0.55) continue;
        visited[q] = 1;
        queue[tail++] = q;
      }
    }
    if (pocket.length >= minPocket) pockets.push([...pocket]);
  }
  // Muitos "bolsões" somados é sinal de vidro claro com reflexos brancos, não de furos de verdade:
  // abrir todos deixaria o frasco esburacado. Só se aceita quando somam pouco perto do próprio frasco.
  let bgSoFar = 0;
  for (let p = 0; p < n; p++) bgSoFar += isBg[p];
  const pocketArea = pockets.reduce((s, p) => s + p.length, 0);
  if (pocketArea <= (n - bgSoFar) * 0.035) for (const pk of pockets) for (const p of pk) isBg[p] = 1;

  // Distância (em pixels, até 3) de cada pixel do frasco ao fundo: só a franja recebe rampa de alfa.
  const near3 = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (isBg[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    let found = 0;
    for (let dy = -2; dy <= 2 && !found; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        if (isBg[yy * width + xx]) {
          found = 1;
          break;
        }
      }
    }
    near3[p] = found;
  }

  let bgCount = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (isBg[p]) {
      data[i + 3] = 0;
      bgCount++;
      continue;
    }
    if (!near3[p]) continue;
    const alpha = Math.min(1, Math.max(0, (dist[p] - tolerance) / feather));
    if (alpha >= 0.999) continue;
    if (alpha <= 0.02) {
      data[i + 3] = 0;
      continue;
    }
    // Tira a mistura com o fundo: c = (c_observado − fundo·(1−α)) / α
    data[i] = Math.min(255, Math.max(0, (data[i] - bgRgb.r * (1 - alpha)) / alpha));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - bgRgb.g * (1 - alpha)) / alpha));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - bgRgb.b * (1 - alpha)) / alpha));
    data[i + 3] = Math.round(alpha * (data[i + 3] ?? 255));
  }

  return { removed: true, background: bgRgb, backgroundShare: bgCount / n };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Caixa do que é visível (alfa > 12), com uma margem proporcional. */
export function opaqueBounds(data: ArrayLike<number>, width: number, height: number, padding = 0.03): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * padding);
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return { x, y, width: Math.min(width, maxX + pad + 1) - x, height: Math.min(height, maxY + pad + 1) - y };
}
