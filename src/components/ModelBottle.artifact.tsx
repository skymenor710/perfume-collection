import { useEffect } from 'react';

/**
 * No link do claude.ai o three.js não vai junto (~150 KB a menos no celular) e um GLB de outro site
 * nem carregaria ali. Se um perfume ganhar `model3DUrl`, o link mostra a foto; o `npm start` mostra o 3D.
 */
export default function ModelBottle({ onError }: { url: string; onError: () => void }) {
  useEffect(() => onError(), [onError]);
  return null;
}
