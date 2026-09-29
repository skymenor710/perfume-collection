import { createHash } from 'node:crypto';
import { CONTENT_REF } from '@perfumes/core/perfume';
import { IMAGE_MIME, sniffImage, type ImageKind } from '../net/sniff';

/**
 * Chaves por conteúdo (FASE 3): "p/<sha256>.<formato>".
 *
 * Regra (ver docs/R2.md):
 *   - a identidade do objeto é o SHA-256 dos bytes; nome, pasta e extensão ORIGINAIS não entram;
 *   - a extensão vem do formato REAL (lido nos bytes), nunca do nome — "a.webp" e "b.png" com os mesmos bytes WebP
 *     viram a mesma chave ".webp";
 *   - só hexadecimal minúsculo, um ponto e uma extensão conhecida: não há como formar "..", barra ou caractere estranho;
 *   - determinística e estável: a mesma foto dá a mesma chave em qualquer computador, em qualquer reinício.
 * O nome útil original (bottles/…, media/…) fica no mapa de migração (media/map.ts), não na chave.
 *
 * A chave é também a referência gravada no banco depois da virada (o formato é validado em
 * @perfumes/core `safeImageRef`), e carrega a prova: objeto cujo SHA-256 não bate com a própria chave é recusado.
 */

const EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', avif: 'avif' };

export interface ContentAddress {
  key: string;
  sha256: string;
  ext: string;
  contentType: string;
  bytes: number;
}

export const sha256Hex = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

/** Chave de um conteúdo. Recusa o que não for imagem raster conhecida (o R2 só guarda fotos). */
export function contentAddress(body: Uint8Array): ContentAddress {
  const kind = sniffImage(body);
  if (!kind) throw new Error('o conteúdo não é uma imagem reconhecida (png, jpeg, webp, gif, avif)');
  const sha256 = sha256Hex(body);
  return { key: `p/${sha256}.${EXT[kind]}`, sha256, ext: EXT[kind], contentType: IMAGE_MIME[kind], bytes: body.length };
}

export const isContentKey = (key: string | null | undefined): boolean => typeof key === 'string' && CONTENT_REF.test(key);

/** O SHA-256 que a chave promete, ou nulo se não for chave por conteúdo. */
export const shaOfContentKey = (key: string): string | null => CONTENT_REF.exec(key)?.[1] ?? null;

/** O conteúdo cumpre o que a chave promete (SHA-256 E formato)? */
export function matchesContentKey(key: string, body: Uint8Array): boolean {
  if (!isContentKey(key)) return false;
  try {
    return contentAddress(body).key === key;
  } catch {
    return false;
  }
}
