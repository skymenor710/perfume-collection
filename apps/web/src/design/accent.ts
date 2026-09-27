import { accentFor, clamp, SILVER } from '@perfumes/core/accent';
import { mixOklab, oklabToRgb, type Oklab, type Rgb } from '@perfumes/core/color';

/**
 * O `AccentController` persegue um alvo em OKLab com suavização exponencial: trocar de perfume nunca "corta"
 * a cor — a anterior se apaga enquanto a nova aparece. O carrossel empurra um alvo contínuo (a mistura entre os
 * dois frascos mais próximos da posição atual), então arrastar entre dois perfumes mistura as duas atmosferas.
 *
 * A regra da cor (`accentFor`, `SILVER`) é pura e mora em @perfumes/core; aqui fica só a parte que anima o DOM.
 */

export { accentFor, SILVER };

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
