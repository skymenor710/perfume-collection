import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { randomUUID } from 'node:crypto';
import type { Storage } from './storage';
import type { ImageVariant } from '../db/schema';

/**
 * Traitement des images envoyées dans l'admin :
 *  1. le contenu réel est vérifié (signature binaire + décodage par sharp) — l'extension et le type MIME annoncés
 *     par le navigateur ne comptent pas ;
 *  2. seuls JPEG, PNG, WebP et AVIF sont acceptés (pas de SVG : pas de script possible dans une image servie) ;
 *  3. l'image est ré-encodée : métadonnées (EXIF, GPS) supprimées, orientation appliquée ;
 *  4. variantes AVIF + WebP en plusieurs largeurs, jamais agrandies.
 */
export const VARIANT_WIDTHS = [480, 640, 800, 1200, 1600] as const;
export const MAX_INPUT_PIXELS = 50_000_000;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);

export class ImageRejected extends Error {}

export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' | null {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

export interface ProcessedImage {
  id: string;
  width: number;
  height: number;
  storagePrefix: string;
  variants: ImageVariant[];
  bytes: number;
}

export async function processAndStoreImage(storage: Storage, projectId: string, input: Buffer, maxBytes: number): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejected('Fichier vide.');
  if (input.length > maxBytes) throw new ImageRejected(`Fichier trop volumineux (maximum ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  const sniffed = sniffImageType(input);
  if (!sniffed) throw new ImageRejected('Format non pris en charge. Formats acceptés : JPEG, PNG, WebP, AVIF.');

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
  } catch {
    throw new ImageRejected('Image illisible ou corrompue.');
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw new ImageRejected('Format non pris en charge.');
  if (!meta.width || !meta.height) throw new ImageRejected('Dimensions de l’image introuvables.');
  if (meta.width < 320 || meta.height < 320) throw new ImageRejected('Image trop petite (320 × 320 px minimum).');

  const id = randomUUID();
  const storagePrefix = `projects/${projectId}/${id}`;
  // Orientation EXIF appliquée une fois ; aucune métadonnée conservée.
  // Décodage COMPLET (pas seulement l'en-tête) : un fichier tronqué ou piégé est refusé ici.
  let oriented: { data: Buffer; info: OutputInfo };
  try {
    oriented = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate().png({ compressionLevel: 0 }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageRejected('Image illisible ou corrompue.');
  }
  const width = oriented.info.width;
  const height = oriented.info.height;

  const variants: ImageVariant[] = [];
  let bytes = 0;
  const widths = [...new Set(VARIANT_WIDTHS.map((w) => Math.min(w, width)))];
  try {
    for (const w of widths) {
      const resized = sharp(oriented.data, { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: w, withoutEnlargement: true });
      const h = Math.round((height * w) / width);
      const avif = await resized.clone().avif({ quality: 52, effort: 2 }).toBuffer();
      const webp = await resized.clone().webp({ quality: 78, effort: 5 }).toBuffer();
      for (const [format, buf] of [['avif', avif], ['webp', webp]] as const) {
        const key = `${storagePrefix}/${w}.${format}`;
        await storage.put(key, buf, `image/${format}`);
        variants.push({ width: w, height: h, format, key, bytes: buf.length });
        bytes += buf.length;
      }
    }
    // Maître privé (non servi) pour régénérer d'autres tailles plus tard.
    const master = await sharp(oriented.data, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    await storage.put(`${storagePrefix}/master.webp`, master, 'image/webp');
  } catch (e) {
    await storage.deletePrefix(storagePrefix).catch(() => {});
    throw e;
  }
  return { id, width, height, storagePrefix, variants, bytes };
}

/** Plus petite variante dont la largeur couvre la demande. */
export function pickVariant(variants: ImageVariant[], format: 'avif' | 'webp', width: number) {
  const list = variants.filter((v) => v.format === format).sort((a, b) => a.width - b.width);
  return list.find((v) => v.width >= width) ?? list[list.length - 1];
}
