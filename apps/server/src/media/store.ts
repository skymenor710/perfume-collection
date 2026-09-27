import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
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

/** Guarda o frasco processado em data/media, com nome aleatório (nada vindo da loja vira nome de arquivo). */
export async function saveBottleMedia(bottle: ProcessedBottle): Promise<SavedMedia> {
  const id = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
  await Promise.all([
    writeFile(path.join(config.mediaDir, `${id}.png`), bottle.master),
    writeFile(path.join(config.mediaDir, `${id}-lg.webp`), bottle.large),
    writeFile(path.join(config.mediaDir, `${id}-sm.webp`), bottle.small),
  ]);
  return {
    imageUrl: `media/${id}-lg.webp`,
    thumbUrl: `media/${id}-sm.webp`,
    masterUrl: `media/${id}.png`,
    dominantColor: bottle.color.hex,
    neutral: bottle.color.neutral,
    cutout: bottle.cutout,
  };
}
