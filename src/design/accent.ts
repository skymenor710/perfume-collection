import { hexToRgb, mixOklab, oklabToOklch, oklabToRgb, oklchToOklab, rgbToOklab, type Oklab, type Rgb } from '../core/color';

/**
 * A cor do frasco vira sotaque da interface — nunca tema.
 *
 * `accentFor` domestica a cor extraída: luminosidade numa faixa estreita e croma com teto, para que um frasco
 * verde-limão não transforme o preto em boate. Frasco neutro (preto, branco, cromado) vira prata fria.
 *
 * O `AccentController` persegue um alvo em OKLab com suavização exponencial: trocar de perfume nunca "corta"
 * a cor — a anterior se apaga enquanto a nova aparece. O carrossel empurra um alvo contínuo (a mistura entre os
 * dois frascos mais próximos da posição atual), então arrastar entre dois perfumes mistura as duas atmosferas.
 */

export const SILVER: Oklab = oklchToOklab({ L: 0.8, C: 0.012, h: 250 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

export interface AccentFrame {
  lab: Oklab;
  rgb: Rgb;
  /** 0 = prata, 1 = cor plena (croma relativo), usado pelo shader para dosar a tinta. */
  saturation: number;
}

type Listener = (frame: AccentFrame) => void;

class AccentController {
  private current: Oklab = SILVER;
  private target: Oklab = SILVER;
  private listeners = new Set<Listener>();
  private raf = 0;
  private last = 0;
  private lastCss = '';
  /** Constante de tempo da transição, em segundos. */
  tau = 0.45;

  setTarget(lab: Oklab, immediate = false) {
    this.target = lab;
    if (immediate) {
      this.current = lab;
      this.emit();
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  blend(a: Oklab, b: Oklab, t: number) {
    this.setTarget(mixOklab(a, b, clamp(t, 0, 1)));
  }

  frame(): AccentFrame {
    const rgb = oklabToRgb(this.current);
    return { lab: this.current, rgb, saturation: clamp(Math.hypot(this.current.a, this.current.b) / 0.14, 0, 1) };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.frame());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const k = 1 - Math.exp(-dt / this.tau);
    this.current = mixOklab(this.current, this.target, k);
    const done = Math.abs(this.current.L - this.target.L) + Math.abs(this.current.a - this.target.a) + Math.abs(this.current.b - this.target.b) < 0.0015;
    if (done) this.current = this.target;
    this.emit();
    this.raf = done ? 0 : requestAnimationFrame(this.tick);
  };

  private emit() {
    const frame = this.frame();
    const css = `${frame.rgb.r} ${frame.rgb.g} ${frame.rgb.b}`;
    if (css !== this.lastCss && typeof document !== 'undefined') {
      this.lastCss = css;
      document.documentElement.style.setProperty('--accent-rgb', css);
    }
    for (const listener of this.listeners) listener(frame);
  }
}

export const accent = new AccentController();
