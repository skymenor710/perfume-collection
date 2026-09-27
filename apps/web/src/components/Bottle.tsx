import { lazy, Suspense, useState } from 'react';
import type { Perfume } from '@perfumes/core/perfume';
import { assetRef } from '../lib/refs';

const ModelBottle = lazy(() => import('./ModelBottle'));

/**
 * Um frasco no palco. Com `model3DUrl`, o modelo 3D real (carregado só quando o frasco está em foco);
 * sem ele, a foto recortada em pé sobre o "piso", com reflexo. Foto que falha vira silhueta — nunca um buraco.
 */
export function Bottle({ perfume, detail, active }: { perfume: Perfume; detail: 'lg' | 'sm'; active: boolean }) {
  const src = assetRef(detail === 'lg' ? (perfume.imageUrl ?? perfume.thumbUrl) : (perfume.thumbUrl ?? perfume.imageUrl));
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [modelFailed, setModelFailed] = useState(false);
  const broken = !src || failed === src;

  if (perfume.model3DUrl && active && !modelFailed) {
    return (
      <div className="bottle bottle--model">
        <Suspense fallback={<BottleImage src={src} broken={broken} loaded={loaded === src} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />}>
          <ModelBottle url={perfume.model3DUrl} onError={() => setModelFailed(true)} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="bottle">
      <BottleImage src={src} broken={broken} loaded={loaded === src || broken} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
    </div>
  );
}

/**
 * Fotos novas vêm no quadro quadrado padrão (@perfumes/core/canvas): o quadro é ampliado para que o frasco mais
 * alto ocupe a altura do palco e a linha de base (92%) caia no piso. Recortes antigos, justos, seguem como antes.
 */
function BottleImage({ src, broken, loaded, onLoad, onError }: { src: string | null; broken: boolean; loaded: boolean; onLoad: () => void; onError: () => void }) {
  const [squareSrc, setSquareSrc] = useState<string | null>(null);
  const canvas = squareSrc === src ? 'square' : 'tight';
  if (broken || !src) {
    return (
      <div className="bottle__art bottle__art--missing" aria-hidden="true">
        <Silhouette />
      </div>
    );
  }
  return (
    <>
      <div className="bottle__art" data-loaded={loaded} data-canvas={canvas}>
        <img
          className="bottle__img"
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && Math.abs(img.naturalWidth - img.naturalHeight) <= 2) setSquareSrc(src);
            onLoad();
          }}
          onError={onError}
        />
        <span className="bottle__sheen" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }} />
      </div>
      <div className="bottle__reflection" aria-hidden="true" data-canvas={canvas}>
        <img src={src} alt="" draggable={false} decoding="async" />
      </div>
    </>
  );
}

/** Frasco genérico em traço fino, para perfume sem foto (ou foto que não carregou). */
export function Silhouette() {
  return (
    <svg className="silhouette" viewBox="0 0 120 200" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
      <rect x="44" y="8" width="32" height="30" rx="1.5" />
      <path d="M50 38v10M70 38v10" />
      <rect x="16" y="48" width="88" height="144" rx="4" />
      <path d="M30 70h60" opacity="0.5" />
    </svg>
  );
}
