import type { Galaxy } from './galaxy';

/**
 * Ponte entre o palco (DOM) e a galáxia (WebGL): o carrossel empurra a posição contínua e o foco,
 * sem que um precise conhecer o outro. Se a galáxia não existir (sem WebGL), as chamadas não fazem nada.
 */
let active: Galaxy | null = null;

export const scene = {
  attach(galaxy: Galaxy | null) {
    active = galaxy;
  },
  scroll(position: number) {
    active?.setScroll(position);
  },
  focus(x: number, y: number) {
    active?.setFocus(x, y);
  },
  pointer(x: number, y: number) {
    active?.setPointer(x, y);
  },
};

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
