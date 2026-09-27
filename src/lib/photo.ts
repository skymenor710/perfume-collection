import { dominantColor, type DominantColor } from '../core/color';
import { placeInCanvas } from '../core/canvas';
import { opaqueBounds, removeBackground } from '../core/cutout';

/**
 * Foto enviada pela pessoa → frasco recortado, no próprio navegador (o mesmo algoritmo do servidor).
 * Usado no link do claude.ai e sem servidor; com o servidor, a foto vai para /api/photo.
 */

export interface ProcessedPhoto {
  large: Blob;
  small: Blob;
  color: DominantColor;
  cutout: boolean;
}

const WORK = 1400;

async function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
}

/** O recorte no quadro quadrado padrão (o mesmo do servidor), no lado pedido. */
async function encode(source: HTMLCanvasElement, side: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const place = placeInCanvas(source.width, source.height, side);
  ctx.drawImage(source, place.left, place.top, place.width, place.height);
  const webp = await toBlob(c, 'image/webp', 0.86);
  // Safari antigo não codifica WebP e devolve PNG silenciosamente; PNG com alfa também serve.
  return webp.type === 'image/webp' ? webp : toBlob(c, 'image/png', 1);
}

export async function processPhoto(file: Blob): Promise<ProcessedPhoto> {
  if (!/^image\//.test(file.type)) throw new Error('not_image');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, WORK / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const image = ctx.getImageData(0, 0, w, h);
  const cut = removeBackground(image.data, w, h);
  ctx.putImageData(image, 0, 0);
  const box = (cut.removed && opaqueBounds(image.data, w, h)) || { x: 0, y: 0, width: w, height: h };

  const cropped = document.createElement('canvas');
  cropped.width = box.width;
  cropped.height = box.height;
  const cctx = cropped.getContext('2d', { willReadFrequently: true })!;
  cctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const color = dominantColor(cctx.getImageData(0, 0, box.width, box.height).data, box.width, box.height, cut.removed);

  const [large, small] = await Promise.all([encode(cropped, 1024), encode(cropped, 384)]);
  return { large, small, color, cutout: cut.removed };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
