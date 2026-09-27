import { useEffect, useRef, useState } from 'react';
import { accent } from '../design/accent';
import { Galaxy, type GalaxyQuality } from '../gl/galaxy';
import { prefersReducedMotion, scene } from '../gl/scene';

function pickQuality(): GalaxyQuality {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = window.innerWidth < 768;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
  if ((coarse || small) && weak) return 'low';
  if (coarse || small) return 'medium';
  return 'high';
}

/** Tela de fundo. Sem WebGL2 (ou se o contexto cair), um degradê CSS com o mesmo sotaque assume. */
export function GalaxyCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!Galaxy.supported()) {
      setFallback(true);
      return;
    }
    let galaxy: Galaxy;
    try {
      galaxy = new Galaxy(el, { quality: pickQuality(), reducedMotion: prefersReducedMotion() }, () => setFallback(true));
    } catch {
      setFallback(true);
      return;
    }
    scene.attach(galaxy);
    const off = accent.subscribe((f) => galaxy.setAccent(f.rgb, f.saturation));
    galaxy.play();
    return () => {
      off();
      scene.attach(null);
      galaxy.dispose();
    };
  }, []);

  return (
    <div className={`galaxy${fallback ? ' galaxy--fallback' : ''}`} aria-hidden="true">
      {!fallback && <canvas ref={canvas} />}
    </div>
  );
}
