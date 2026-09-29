/**
 * Endereços do próprio app. No modo servidor a base é "/" (absoluta): a página pode estar em /guilherme/wishlist e
 * a API continua em /api/…, as fotos em /bottles/… e /media/…. No link do claude.ai a base é "./" (relativa), como
 * a plataforma exige. Quem decide é o Vite (`base` em vite.config.ts), por modo de compilação.
 */
const BASE = import.meta.env.BASE_URL;

/** "api/perfumes" → "/api/perfumes" (servidor) ou "./api/perfumes" (claude.ai, onde a API nem existe). */
export const apiPath = (path: string) => `${BASE}${path.replace(/^\/+/, '')}`;

/**
 * Foto guardada como "bottles/…", "media/…" ou "p/…" (por conteúdo, FASE 3) → endereço no próprio servidor; o resto
 * (blob:, data:, https:) passa. "/p/…" é resolvido pelo servidor (R2 ou cópia local): a página não conhece o R2.
 */
export function assetRef(ref: string): string;
export function assetRef(ref: string | null): string | null;
export function assetRef(ref: string | null): string | null {
  return ref && /^(bottles|media|p)\//.test(ref) ? `${BASE}${ref}` : ref;
}
