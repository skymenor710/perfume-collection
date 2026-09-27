import { randomBytes } from 'node:crypto';
import { mediaStorage } from '../storage/local';
import type { StorageProvider } from '../storage/types';
import type { ProcessedBottle } from './process';

export interface SavedMedia {
  imageUrl: string;
  thumbUrl: string;
  /** O arquivo guardado: PNG 2048×2048 com fundo transparente. */
  masterUrl: string;
  dominantColor: string;
  neutral: boolean;
  cutout: boolean;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Guarda o frasco processado no armazenamento de mídia, com nome aleatório (nada vindo da loja vira nome de
 * arquivo). As referências devolvidas ("media/…") são as que ficam gravadas na biblioteca.
 */
export async function saveBottleMedia(bottle: ProcessedBottle, storage: StorageProvider = mediaStorage): Promise<SavedMedia> {
  const id = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
  const keys = { master: `${id}.png`, large: `${id}-lg.webp`, small: `${id}-sm.webp` };
  await Promise.all([
    storage.put(keys.master, bottle.master, { contentType: 'image/png', cacheControl: IMMUTABLE }),
    storage.put(keys.large, bottle.large, { contentType: 'image/webp', cacheControl: IMMUTABLE }),
    storage.put(keys.small, bottle.small, { contentType: 'image/webp', cacheControl: IMMUTABLE }),
  ]);
  return {
    imageUrl: storage.publicUrl(keys.large),
    thumbUrl: storage.publicUrl(keys.small),
    masterUrl: storage.publicUrl(keys.master),
    dominantColor: bottle.color.hex,
    neutral: bottle.color.neutral,
    cutout: bottle.cutout,
  };
}
