/**
 * Tipo REAL de uma imagem, pelos primeiros bytes — o cabeçalho Content-Type vem de quem enviou e pode mentir.
 *
 * Só formatos raster que o processamento (sharp) abre com segurança. SVG é recusado sempre: é XML, pode carregar
 * script e referências externas, e não é foto de frasco.
 */

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'avif';

export const IMAGE_MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));

export function sniffImage(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  const gif = ascii(buf, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp') {
    // Marca principal ou compatíveis dentro da caixa ftyp.
    const boxSize = Math.min(buf.length, Math.max(16, (buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!));
    const brands = ascii(buf, 8, boxSize);
    if (/avif|avis/.test(brands)) return 'avif';
  }
  return null;
}

/** Parece SVG/XML/HTML (texto começando com "<", depois de BOM e espaços)? */
export function looksLikeMarkup(buf: Uint8Array): boolean {
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  while (i < buf.length && i < 1024 && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  if (buf[i] !== 0x3c) return false;
  const head = ascii(buf, i, Math.min(buf.length, i + 512)).toLowerCase();
  return /^<(\?xml|svg|!doctype|html|!--)/.test(head) || head.includes('<svg');
}

export function isSvgContentType(contentType: string): boolean {
  return /svg/i.test(contentType);
}

export type ImageCheck = { ok: true; kind: ImageKind; mime: string } | { ok: false; reason: 'svg' | 'not_image' };

/** Aceita só raster conhecido, pelo conteúdo. O Content-Type declarado serve apenas para recusar SVG explícito. */
export function checkImageBytes(buf: Uint8Array, declaredType = ''): ImageCheck {
  if (isSvgContentType(declaredType) || looksLikeMarkup(buf)) return { ok: false, reason: 'svg' };
  const kind = sniffImage(buf);
  return kind ? { ok: true, kind, mime: IMAGE_MIME[kind] } : { ok: false, reason: 'not_image' };
}
