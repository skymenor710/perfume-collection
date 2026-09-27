import { hexToRgb, oklabToOklch, oklchToOklab, rgbToOklab, type Oklab } from './color';

/**
 * A cor do frasco vira sotaque da interface — nunca tema.
 *
 * `accentFor` domestica a cor extraída: luminosidade numa faixa estreita e croma com teto, para que um frasco
 * verde-limão não transforme o preto em boate. Frasco neutro (preto, branco, cromado) vira prata fria.
 * Puro (sem DOM): o servidor usa a mesma regra para gravar a cor de cada perfume.
 */

export const SILVER: Oklab = oklchToOklab({ L: 0.8, C: 0.012, h: 250 });

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function accentFor(hex: string | null | undefined): Oklab {
  if (!hex) return SILVER;
  let lch;
  try {
    lch = oklabToOklch(rgbToOklab(hexToRgb(hex)));
  } catch {
    return SILVER;
  }
  if (lch.C < 0.035) return oklchToOklab({ L: 0.8, C: 0.012, h: lch.C > 0.006 ? lch.h : 250 });
  return oklchToOklab({ L: clamp(lch.L, 0.68, 0.8), C: clamp(lch.C * 1.15, 0.07, 0.145), h: lch.h });
}
