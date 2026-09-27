/*
 * Service worker do Meus Perfumes.
 *
 * Estratégias (só GET da própria origem; o resto passa direto):
 *   /assets/*, /icons/*        cache primeiro — nomes com hash, nunca mudam
 *   /bottles/*, /media/*       cache primeiro — cada foto tem nome único; limite de 300 fotos guardadas
 *   páginas, /api/perfumes,    rede primeiro, cache se estiver sem conexão — offline dá para abrir e navegar
 *   /api/status, /api/me,      pela última coleção vista (adicionar e pesquisar precisam do computador)
 *   /api/public/*
 *   /api/events e escritas     nunca passam pelo cache
 *
 * Trocar VERSION descarta os caches antigos na próxima ativação.
 */
const VERSION = 'v1';
const STATIC = `mp-static-${VERSION}`;
const IMAGES = `mp-images-${VERSION}`;
const PAGES = `mp-pages-${VERSION}`;
const MAX_IMAGES = 300;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mp-') && ![STATIC, IMAGES, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (limit) {
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
    }
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(request)) ?? (fallbackUrl ? await cache.match(fallbackUrl) : undefined);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path === '/api/events' || path === '/sw.js') return;
  if (path.startsWith('/assets/') || path.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (path.startsWith('/bottles/') || path.startsWith('/media/')) {
    event.respondWith(cacheFirst(request, IMAGES, MAX_IMAGES));
    return;
  }
  if (path === '/api/perfumes' || path === '/api/status' || path === '/api/me' || path.startsWith('/api/public/')) {
    event.respondWith(networkFirst(request, PAGES));
    return;
  }
  if (path.startsWith('/api/')) return;
  if (request.mode === 'navigate' || path === '/manifest.webmanifest') {
    event.respondWith(networkFirst(request, PAGES, '/'));
  }
});
