import { rgbToOklab } from './color';

/**
 * Avaliação de uma foto de produto JÁ recortada (RGBA, fundo com alfa 0), para escolher a melhor entre várias.
 * Mede o que faz um frasco parecer bem fotografado no palco — e recusa o que o faria parecer colado:
 * frasco cortado pela borda da foto, caixa ou objetos junto, fundo que não saiu, halo claro, baixa resolução.
 */

export interface QualityReport {
  /** 0–100; abaixo de 45 a foto é recusada. */
  score: number;
  accepted: boolean;
  reasons: string[];
  metrics: {
    bottleHeightPx: number;
    roughness: number;
    holes: number;
    aspect: number;
    fill: number;
    touchesEdge: number;
    secondComponent: number;
    halo: number;
    sharpness: number;
    /** Fração do contorno que passa por bordas reais da foto (medida no servidor, que tem a foto original). */
    edgeSupport?: number;
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Componentes conexos (alfa > 128) numa grade reduzida: 1 frasco = 1 componente grande. */
function componentsRatio(alpha: Uint8Array, w: number, h: number): { second: number; others: number } {
  const seen = new Uint8Array(w * h);
  const comps: { size: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || alpha[start] <= 128) continue;
    let size = 0;
    const c = { size: 0, minX: w, maxX: 0, minY: h, maxY: 0 };
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!seen[q] && alpha[q] > 128) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    c.size = size;
    comps.push(c);
  }
  comps.sort((a, b) => b.size - a.size);
  if (comps.length < 2) return { second: 0, others: 0 };
  const body = comps[0];
  // Tampa separada do corpo por um vão fino: logo acima dele e centrada nele. É parte do frasco, não objeto.
  const isCap = (c: (typeof comps)[number]) => {
    const cx = (c.minX + c.maxX) / 2;
    return cx > body.minX && cx < body.maxX && c.maxY <= body.minY + (body.maxY - body.minY) * 0.08 && c.minY >= body.minY - (body.maxY - body.minY) * 0.6;
  };
  const rest = comps.slice(1).filter((c) => !isCap(c));
  if (!rest.length) return { second: 0, others: 0 };
  return { second: rest[0].size / body.size, others: rest.reduce((a, b) => a + b.size, 0) / body.size };
}

export function assessCutout(
  data: ArrayLike<number>,
  width: number,
  height: number,
  removed: boolean,
  sourceHeight: number,
  background: { r: number; g: number; b: number } | null = null,
  /** Borda já descontaminada (recorte por IA): a medida de halo não se aplica. */
  skipHalo = false,
): QualityReport {
  const reasons: string[] = [];
  // Grade reduzida (máx. ~240 px) para medir forma sem custo.
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 240));
  const gw = Math.ceil(width / step);
  const gh = Math.ceil(height / step);
  const alpha = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) alpha[y * gw + x] = data[((y * step) * width + x * step) * 4 + 3];

  let minX = gw;
  let minY = gh;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (alpha[y * gw + x] > 128) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const boxW = Math.max(1, maxX - minX + 1);
  const boxH = Math.max(1, maxY - minY + 1);
  const aspect = boxW / boxH;
  const fill = opaque / (boxW * boxH);

  // Frasco encostado na borda da foto = frasco cortado (tampa ou base de fora).
  // Encostar só na borda de BAIXO é comum em foto enquadrada justa (a base está lá, apoiada); em cima ou
  // dos lados, é a tampa ou o corpo saindo do quadro.
  let edge = 0;
  let bottom = 0;
  for (let x = 0; x < gw; x++) {
    edge += Number(alpha[x] > 128);
    bottom += Number(alpha[(gh - 1) * gw + x] > 128);
  }
  for (let y = 0; y < gh - 1; y++) edge += Number(alpha[y * gw] > 128) + Number(alpha[y * gw + gw - 1] > 128);
  const touchesEdge = edge / (2 * (gw + gh));
  const touchesBottom = bottom / gw;

  const comps = removed ? componentsRatio(alpha, gw, gh) : { second: 0, others: 0 };
  const secondComponent = comps.second;
  // Névoa: muitos pixels semitransparentes (brilho, fumaça, reflexo difuso) em volta do frasco.
  let visible = 0;
  let soft = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 16) visible++;
    if (alpha[i] > 16 && alpha[i] < 200) soft++;
  }
  const softShare = visible ? soft / visible : 0;
  const bgLab = rgbToOklab(background ?? { r: 255, g: 255, b: 255 });
  const bgL = bgLab.L;

  // Halo: pixels da borda do frasco claros e sem cor, quando o frasco em si não é claro.
  let ring = 0;
  let ringWhite = 0;
  let inner = 0;
  let innerL = 0;
  let lap = 0;
  let lapN = 0;
  const lum = (i: number) => rgbToOklab({ r: data[i], g: data[i + 1], b: data[i + 2] });
  const fstep = Math.max(1, Math.floor(step / 2));
  for (let y = fstep; y < height - fstep; y += fstep) {
    for (let x = fstep; x < width - fstep; x += fstep) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 96) continue;
      const neighbours = [data[i + 3 - 4 * fstep], data[i + 3 + 4 * fstep], data[i + 3 - 4 * width * fstep], data[i + 3 + 4 * width * fstep]];
      const lab = lum(i);
      if (neighbours.some((n) => n < 40)) {
        ring++;
        // Halo = resto do FUNDO na borda (cor quase igual à do fundo removido), não o brilho do metal ou do vidro.
        // Só na franja semitransparente: pixel opaco claro na borda é brilho do objeto, não vazamento do fundo.
        if (a < 235 && Math.hypot(lab.L - bgLab.L, lab.a - bgLab.a, lab.b - bgLab.b) < 0.045) ringWhite++;
      } else {
        inner++;
        innerL += lab.L;
        // Nitidez: laplaciano da luminância (aproximada pelo verde) no miolo do frasco.
        const c = data[i + 1];
        const l4 = data[i + 1 - 4 * fstep] + data[i + 1 + 4 * fstep] + data[i + 1 - 4 * width * fstep] + data[i + 1 + 4 * width * fstep];
        lap += Math.abs(l4 - 4 * c);
        lapN++;
      }
    }
  }
  const meanL = inner ? innerL / inner : 0.5;
  const halo = !skipHalo && ring && meanL < 0.78 ? ringWhite / ring : 0;
  const sharpness = lapN ? lap / lapN : 0;

  const bottleHeightPx = Math.round((boxH / gh) * sourceHeight);

  // Aspereza do contorno (resolução cheia): pixels de borda ÷ perímetro da caixa. Frasco liso ≈ 1,0;
  // borda corroída pelo recorte (vidro claro, respingos) passa de 1,19 (textura de tampa fica abaixo).
  let edgePx = 0;
  let fx0 = width;
  let fx1 = 0;
  let fy0 = height;
  let fy1 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4 + 3;
      if (data[i] <= 128) continue;
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
      if (y < fy0) fy0 = y;
      if (y > fy1) fy1 = y;
      if (data[i - 4] <= 128 || data[i + 4] <= 128 || data[i - 4 * width] <= 128 || data[i + 4 * width] <= 128) edgePx++;
    }
  }
  const roughness = fx1 > fx0 ? edgePx / (2 * (fx1 - fx0 + (fy1 - fy0))) : 1;

  // Buracos: transparência cercada pelo frasco (o recorte "furou" vidro, rótulo ou metal). O vão de uma
  // alça ou argola é legítimo e pequeno; buraco somando mais de ~6% do frasco não é.
  const outside = new Uint8Array(gw * gh);
  const queue: number[] = [];
  const push = (p: number) => {
    if (!outside[p] && alpha[p] <= 128) {
      outside[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < gw; x++) {
    push(x);
    push((gh - 1) * gw + x);
  }
  for (let y = 0; y < gh; y++) {
    push(y * gw);
    push(y * gw + gw - 1);
  }
  while (queue.length) {
    const p = queue.pop()!;
    const x = p % gw;
    if (x > 0) push(p - 1);
    if (x < gw - 1) push(p + 1);
    if (p >= gw) push(p - gw);
    if (p < gw * (gh - 1)) push(p + gw);
  }
  let holePx = 0;
  for (let p = 0; p < gw * gh; p++) if (alpha[p] <= 128 && !outside[p]) holePx++;
  const holes = opaque ? holePx / opaque : 0;

  let score = 100;
  if (!removed) {
    score -= 55;
    reasons.push('fundo não é liso (foto de ambiente)');
  }
  if (touchesEdge > 0.012) {
    score -= 60;
    reasons.push('frasco cortado pela borda da foto');
  }
  if (comps.others > 0.06 && secondComponent <= 0.1) {
    score -= 30;
    reasons.push('partículas ou objetos soltos em volta');
  }
  if (removed && bgL < 0.72) {
    score -= 30;
    reasons.push('fundo escuro ou cenográfico (foto de campanha)');
  }
  if (softShare > 0.12) {
    score -= 25;
    reasons.push('brilho ou névoa em volta do frasco');
  }
  if (secondComponent > 0.1) {
    score -= 30 + Math.round(secondComponent * 40);
    reasons.push('caixa ou objetos junto do frasco');
  }
  if (aspect < 0.28 || aspect > 1.35) {
    score -= 30;
    reasons.push('proporção estranha para um frasco');
  }
  if (touchesBottom > 0.02) {
    score -= 12;
    reasons.push('base encostada na borda de baixo');
  }
  // Silhueta retangular cheia, com os quatro cantos opacos, ocupando quase a foto toda: sobrou o fundo inteiro
  // (foto não recortada, ou PNG "transparente" com fundo cinza). Um frasco quadrado bem recortado não cai aqui:
  // ele não ocupa o quadro de ponta a ponta.
  const corner = (x: number, y: number) => alpha[y * gw + x] > 128;
  const cornersOpaque = maxX >= 0 && corner(minX, minY) && corner(maxX, minY) && corner(minX, maxY) && corner(maxX, maxY);
  const boxShare = maxX >= 0 ? ((maxX - minX + 1) * (maxY - minY + 1)) / (gw * gh) : 0;
  if (removed && cornersOpaque && fill > 0.95 && boxShare > 0.7) {
    score -= 70;
    reasons.push('fundo retangular (a foto não foi recortada)');
  }
  if (fill < 0.6) {
    score -= fill < 0.42 ? 40 : 28;
    reasons.push('objetos ou decoração em volta do frasco');
  }
  // Mais largo que alto: quase sempre é a caixa (ou outro frasco) encostada ao lado.
  if (aspect > 1.05 && aspect <= 1.35) {
    score -= 25;
    reasons.push('largo demais: caixa ou objeto ao lado');
  }
  if (removed && holes > 0.06) {
    score -= holes > 0.12 ? 35 : 20;
    reasons.push('buracos no frasco (recorte furou vidro ou rótulo)');
  }
  if (removed && roughness > 1.19) {
    score -= 20;
    reasons.push('contorno irregular (recorte comeu a borda)');
  }
  if (halo > 0.18) {
    score -= Math.round(halo * 60);
    reasons.push('halo claro na borda');
  }
  // Resolução: 1100 px de frasco é o alvo do palco.
  score -= Math.round((1 - clamp01(bottleHeightPx / 1100)) * 25);
  if (bottleHeightPx < 450) reasons.push('resolução baixa');
  if (sharpness < 6) {
    score -= 10;
    reasons.push('pouca nitidez');
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    accepted: score >= 45 && touchesEdge <= 0.012 && removed,
    reasons,
    metrics: { bottleHeightPx, roughness: Number(roughness.toFixed(3)), holes: Number(holes.toFixed(3)), aspect: Number(aspect.toFixed(3)), fill: Number(fill.toFixed(3)), touchesEdge: Number(touchesEdge.toFixed(4)), secondComponent: Number(secondComponent.toFixed(3)), halo: Number(halo.toFixed(3)), sharpness: Number(sharpness.toFixed(1)) },
  };
}
