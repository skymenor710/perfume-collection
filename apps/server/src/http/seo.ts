import { parsePublicPath, type ListKind, type PublicPath } from '@perfumes/core/library';
import type { Perfume } from '@perfumes/core/perfume';
import { config } from '../config';
import type { LibraryRepository } from '../repositories/library';

/**
 * Metadados por página (título, descrição, canonical, Open Graph, Twitter card) para os endereços públicos
 * /username, /username/wishlist e /username/collection — assim o link colado no WhatsApp, iMessage etc. gera
 * prévia. Montados NO SERVIDOR (quem gera a prévia não roda JavaScript). Só o que a privacidade permite.
 */

export type PublicRoute = PublicPath;
export const parsePublicRoute = parsePublicPath;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PageMeta {
  status: number;
  title: string;
  description: string;
  canonical: string | null;
  image: string | null;
  robots: string | null;
}

const LIST_LABEL: Record<ListKind, string> = { wishlist: 'Wishlist', collection: 'Coleção' };

export async function publicPageMeta(route: PublicRoute, origin: string, repo: LibraryRepository): Promise<PageMeta> {
  const profile = await repo.publicProfile(route.username);
  const notPublic: PageMeta = { status: 404, title: 'Meus Perfumes', description: 'Esta página não é pública.', canonical: null, image: null, robots: 'noindex' };
  if (!profile) return notPublic;
  const lists: ListKind[] = route.list ? [route.list] : profile.lists;
  if (route.list && !profile.lists.includes(route.list)) return notPublic;
  const perfumes: Perfume[] = (await Promise.all(lists.map((l) => repo.publicList(route.username, l)))).flatMap((l) => l ?? []);
  const name = profile.user.displayName;
  const title = route.list ? `${LIST_LABEL[route.list]} de ${name} · Meus Perfumes` : `${name} · Meus Perfumes`;
  const names = perfumes.slice(0, 4).map((p) => p.name);
  const count = perfumes.length;
  const description = count
    ? `${count} ${count === 1 ? 'perfume' : 'perfumes'}${route.list ? ` na ${LIST_LABEL[route.list].toLowerCase()}` : ''} de ${name}: ${names.join(', ')}${count > names.length ? '…' : '.'}`
    : `${route.list ? `${LIST_LABEL[route.list]} de ${name}` : `Perfumes de ${name}`} — ainda vazia.`;
  const cover = perfumes.find((p) => p.imageUrl)?.imageUrl ?? null;
  const path = `/${profile.user.username}${route.list ? `/${route.list}` : ''}`;
  return { status: 200, title, description, canonical: `${origin}${path}`, image: cover ? `${origin}/${cover}` : null, robots: null };
}

/** Tags de instalação (PWA): manifest, ícone da tela inicial do iPhone, barra de status. */
const PWA_TAGS = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Perfumes">',
].join('');

/** index.html do app com: marca de servidor, tags de PWA e — em página pública — metadados da página. */
export function renderIndex(html: string, meta: PageMeta | null): string {
  let head = `<meta name="perfumes-server" content="1">${PWA_TAGS}`;
  if (meta) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
    html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(meta.description)}">`);
    const og = [
      `<meta property="og:site_name" content="Meus Perfumes">`,
      `<meta property="og:type" content="profile">`,
      `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
      `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
      ...(meta.canonical ? [`<link rel="canonical" href="${escapeHtml(meta.canonical)}">`, `<meta property="og:url" content="${escapeHtml(meta.canonical)}">`] : []),
      ...(meta.image ? [`<meta property="og:image" content="${escapeHtml(meta.image)}">`, `<meta property="og:image:width" content="1024">`, `<meta property="og:image:height" content="1024">`] : []),
      `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
      ...(meta.image ? [`<meta name="twitter:image" content="${escapeHtml(meta.image)}">`] : []),
      ...(meta.robots ? [`<meta name="robots" content="${meta.robots}">`] : []),
    ];
    head += og.join('');
  }
  return html.replace('<head>', `<head>${head}`);
}

/** Origem usada nos links canônicos: a pública configurada, ou a do próprio pedido (PC/Wi-Fi). */
export const originFor = (host: string | undefined) => config.publicOrigin ?? `http://${host ?? `localhost:${config.port}`}`;
