/**
 * O quadro de todo frasco: quadrado, fundo transparente, frasco centrado na horizontal, no máximo 72% da
 * largura e 84% da altura, com a base sempre na linha de 92%. Mesmo número no servidor (sharp), no navegador
 * (foto enviada) e no CSS do palco (--canvas-*), para que todos os frascos fiquem na mesma escala e no mesmo piso.
 */
export const BOTTLE_CANVAS = {
  size: 2048,
  maxWidth: 0.72,
  maxHeight: 0.84,
  baseline: 0.92,
} as const;

/** Onde o recorte entra no quadro de lado `side`. */
export function placeInCanvas(width: number, height: number, side: number) {
  const scale = Math.min((side * BOTTLE_CANVAS.maxWidth) / width, (side * BOTTLE_CANVAS.maxHeight) / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, left: Math.round((side - w) / 2), top: Math.round(side * BOTTLE_CANVAS.baseline) - h };
}
