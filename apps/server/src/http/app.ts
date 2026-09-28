import { createReadStream, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { ASSET_VERSION, sanitizePerfume } from '@perfumes/core/perfume';
import { config } from '../config';
import { importFromUrl } from '../import/pipeline';
import { processBottleOffThread as processBottleImage } from '../media/offthread';
import { getRequestListener } from '@hono/node-server';
import { ImportJobRunner } from '../jobs/runner';
import { MemoryImportJobStore } from '../jobs/memory-store';
import { researchSlots } from '../jobs/slots';
import { saveBottleMedia } from '../media/store';
import { checkImageBytes } from '../net/sniff';
import type { LibraryRepository } from '../repositories/library';
import { mediaStorage } from '../storage/local';
import type { StorageProvider } from '../storage/types';
import { store } from '../store';
import type { ListKind, User } from '@perfumes/core/library';
import { HttpError, checkHost, checkSameOrigin, isAuthorized, isLoopback, pairDevice, requireAuthorized } from './guard';
import { decodePath, inside } from './paths';
import { createV1, type Authorizer } from './v1';
import { originFor, parsePublicRoute, publicPageMeta, renderIndex, type PageMeta } from './seo';
import { event, log, safePath } from '../log';

/**
 * Rotas do servidor local. Toda resposta de erro é uma frase para a pessoa + um código;
 * detalhes técnicos ficam só no terminal.
 */

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const PAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) return Promise.reject(new HttpError(413, 'too_large', 'O arquivo é grande demais.'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError(413, 'too_large', 'O arquivo é grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'bad_request', 'Não consegui ler o que foi enviado.')));
  });
}

async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  if (!/application\/json/i.test(String(req.headers['content-type'] ?? ''))) throw new HttpError(415, 'unsupported', 'Formato não suportado.');
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req, maxBytes)).toString('utf8') || '{}');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'bad_json', 'Formato inválido.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, 'invalid', 'Confira os dados enviados.');
  return parsed.data;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveIndex(res: ServerResponse, meta: PageMeta | null = null) {
  const index = inside(config.distDir, 'index.html');
  if (!index) throw new HttpError(503, 'not_built', 'O site ainda não foi montado. Rode npm start.');
  const html = renderIndex(readFileSync(index, 'utf8'), meta);
  res.writeHead(meta?.status ?? 200, { ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache' });
  res.end(html);
}

/** Leituras públicas (sem conta): limite por endereço, contra varredura. */
const publicHits = new Map<string, { count: number; since: number }>();
function limitPublic(req: IncomingMessage) {
  const key = req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const hit = publicHits.get(key);
  const entry = hit && now - hit.since < 60_000 ? hit : { count: 0, since: now };
  entry.count++;
  publicHits.set(key, entry);
  if (entry.count > 120) throw new HttpError(429, 'rate_limited', 'Muitos acessos seguidos. Tente de novo em um minuto.');
}

/**
 * Pesquisas pesadas (baixar fotos, recorte por IA) ao mesmo tempo: no máximo duas, somando os jobs da API v1.
 * Reserva uma vaga ANTES de abrir a resposta em fluxo (a recusa chega como erro JSON normal).
 */
function acquireResearch(): () => void {
  const release = researchSlots.tryAcquire();
  if (!release) throw new HttpError(429, 'busy', 'Já estou pesquisando dois perfumes. Espere um deles terminar.');
  return release;
}

const meSchema = z.object({
  username: z.string().min(1).max(40).optional(),
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(280).nullable().optional(),
  privacy: z
    .object({ profile: z.enum(['public', 'private']).optional(), wishlist: z.enum(['public', 'private']).optional(), collection: z.enum(['public', 'private']).optional() })
    .optional(),
});

const publicUser = (u: User) => ({ username: u.username, displayName: u.displayName, bio: u.bio, avatarUrl: u.avatarUrl });

function serveBuffer(res: ServerResponse, body: Buffer, contentType: string, cache: string) {
  res.writeHead(200, { ...PAGE_HEADERS, 'Content-Type': contentType, 'Content-Length': body.length, 'Cache-Control': cache });
  res.end(body);
}

function serveFile(res: ServerResponse, filePath: string, cache: string) {
  const stat = statSync(filePath);
  res.writeHead(200, {
    ...PAGE_HEADERS,
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  createReadStream(filePath).pipe(res);
}


const importSchema = z.object({
  url: z.string().min(4).max(2048),
  /** Quando o sistema perguntou "qual perfume é este?": marca e nome ditos pela pessoa. */
  identity: z.object({ brand: z.string().max(80).optional(), name: z.string().min(1).max(140) }).optional(),
  /** Variante escolhida na pergunta "qual versão?". */
  variantId: z.string().min(1).max(80).optional(),
});
const refreshSchema = z.object({ variantId: z.string().min(1).max(80).optional() });

/** Corpo JSON opcional (pedidos antigos chegam sem corpo). */
async function readOptionalJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  if (!/application\/json/i.test(String(req.headers['content-type'] ?? ''))) return schema.parse({});
  return readJson(req, schema);
}
const pairSchema = z.object({ code: z.string().min(4).max(20) });

export interface HandlerDeps {
  repo?: LibraryRepository;
  media?: StorageProvider;
  jobs?: ImportJobRunner;
  authorize?: Authorizer;
}

export function createHandler(deps: HandlerDeps = {}) {
  const repo = deps.repo ?? store;
  const media = deps.media ?? mediaStorage;
  // Jobs em memória nesta etapa (sem banco): reiniciar o servidor esquece jobs, nunca a coleção.
  const jobs = deps.jobs ?? new ImportJobRunner(new MemoryImportJobStore());
  // Hoje há um usuário só: quem passou pela proteção (este computador ou aparelho pareado) age como ele.
  const authorize: Authorizer = deps.authorize ?? (async (req) => (isAuthorized(req) ? { userId: (await repo.me()).id, via: isLoopback(req) ? 'loopback' : 'device' } : null));
  const v1 = getRequestListener(createV1({ repo, jobs, authorize }).fetch);

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      checkHost(req);
      const url = new URL(req.url ?? '/', 'http://local');
      const route = `${req.method} ${url.pathname}`;

      if (url.pathname.startsWith('/api/')) {
        checkSameOrigin(req);
        // API v1 (Hono): mesmas proteções de Host e origem acima; autorização dentro dela.
        if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) return await v1(req, res);
        if (route === 'GET /api/status') return sendJson(res, 200, { app: 'perfume-collection', authorized: isAuthorized(req) });
        if (route === 'POST /api/pair') {
          const { code } = await readJson(req, pairSchema);
          return sendJson(res, 200, { ok: true }, { 'Set-Cookie': pairDevice(req, code) });
        }

        // PÚBLICO — sem código de acesso, só leitura, só o que a pessoa abriu (padrão: tudo privado).
        const pub = /^\/api\/public\/([a-z0-9._]{3,30})(?:\/(wishlist|collection))?$/i.exec(url.pathname);
        if (pub && req.method === 'GET') {
          limitPublic(req);
          const profile = await repo.publicProfile(pub[1]);
          if (!profile) throw new HttpError(404, 'not_public', 'Esta página não é pública.');
          const lists: ListKind[] = pub[2] ? [pub[2].toLowerCase() as ListKind] : profile.lists;
          if (pub[2] && !profile.lists.includes(lists[0])) throw new HttpError(404, 'not_public', 'Esta lista não é pública.');
          const perfumes = (await Promise.all(lists.map((l) => repo.publicList(pub[1], l)))).flatMap((l) => l ?? []);
          return sendJson(res, 200, { user: publicUser(profile.user), lists: profile.lists, perfumes }, { 'Cache-Control': 'no-cache' });
        }

        requireAuthorized(req);

        // PERFIL do dono desta instalação (enquanto não há contas: quem passou pelo código de acesso).
        if (route === 'GET /api/me') return sendJson(res, 200, { user: await repo.me() });
        if (route === 'PATCH /api/me') {
          const patch = await readJson(req, meSchema);
          try {
            return sendJson(res, 200, { user: await repo.updateMe(patch) });
          } catch (error) {
            throw new HttpError(422, 'invalid', (error as Error).message);
          }
        }

        if (route === 'GET /api/perfumes') return sendJson(res, 200, { revision: await repo.revision(), perfumes: await repo.list() });

        const one = /^\/api\/perfumes\/([\w-]{1,80})$/.exec(url.pathname);
        if (one && req.method === 'PUT') {
          const body = await readJson(req, z.record(z.string(), z.unknown()), 256 * 1024);
          const perfume = sanitizePerfume({ ...body, id: one[1], updatedAt: new Date().toISOString() });
          if (!perfume) throw new HttpError(422, 'invalid', 'O perfume precisa de um nome.');
          return sendJson(res, 200, { perfume: await repo.upsert(perfume) });
        }
        const refresh = /^\/api\/perfumes\/([\w-]{1,80})\/refresh$/.exec(url.pathname);
        if (refresh && req.method === 'POST') {
          const current = (await repo.list()).find((p) => p.id === refresh[1]);
          if (!current) throw new HttpError(404, 'not_found', 'Esse perfume não está mais na coleção.');
          if (!current.brand) throw new HttpError(422, 'invalid', 'Preciso da marca para pesquisar esse perfume.');
          const { variantId } = await readOptionalJson(req, refreshSchema);
          const release = acquireResearch();
          res.on('close', release);
          res.on('finish', release);
          res.writeHead(200, { ...API_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          // Mesmo resolvedor do "adicionar", com a identidade já conhecida (o nome e a marca que estão na coleção).
          const outcome = await importFromUrl(
            current.sourceUrl ?? '',
            // Com variantes em jogo, o tamanho guardado não força a escolha: quem decide é a pessoa.
            { brand: current.brand, name: current.name, concentration: current.concentration, volume: current.variants.length > 1 || variantId ? null : current.volume },
            (stage) => res.write(`${JSON.stringify({ stage })}\n`),
            variantId ?? current.selectedVariantId,
          );
          if (outcome.ok === 'choose') {
            res.end(`${JSON.stringify({ choose: outcome })}\n`);
            return;
          }
          const found = outcome.ok ? outcome.perfume : null;
          const updated = sanitizePerfume({
            ...current,
            ...(found?.media
              ? {
                  imageUrl: found.media.imageUrl,
                  thumbUrl: found.media.thumbUrl,
                  masterUrl: found.media.masterUrl,
                  dominantColor: found.media.dominantColor,
                  dominantColorOverride: null,
                  imageSource: found.imageSource,
                  imageCredit: found.imageCredit ?? current.imageCredit,
                  accentColor: found.accentColor,
                  accentGlow: found.accentGlow,
                }
              : {}),
            olfactoryProfile: found?.olfactoryProfile ?? current.olfactoryProfile,
            fieldSources: { ...current.fieldSources, ...(found?.fieldSources ?? {}) },
            // O que faltava (preço, tamanho) entra; o que a pessoa já tinha, fica.
            ...(current.price === null && found?.price != null && found.currency ? { price: found.price, currency: found.currency } : {}),
            ...(!current.volume && found?.volume ? { volume: found.volume } : {}),
            // A variante é um objeto só: quando há uma, tamanho, preço, moeda e link vêm todos dela.
            ...(found?.variant && found.variants.length > 1
              ? {
                  variants: found.variants,
                  selectedVariantId: found.variant.id,
                  variantUrl: found.variantUrl,
                  volume: found.variant.volume ?? current.volume,
                  price: found.variant.price !== null && found.variant.currency ? found.variant.price : current.price,
                  currency: found.variant.price !== null && found.variant.currency ? found.variant.currency : current.currency,
                  priceNote: found.variant.price !== null && found.variant.currency ? null : current.priceNote,
                }
              : {}),
            assetVersion: ASSET_VERSION,
            updatedAt: new Date().toISOString(),
          });
          if (updated) await repo.upsert(updated);
          res.end(`${JSON.stringify({ perfume: updated, notes: outcome.ok === true ? outcome.notes : outcome.ok === false ? [outcome.message] : [] })}\n`);
          return;
        }
        if (one && req.method === 'DELETE') {
          await repo.remove(one[1]);
          return sendJson(res, 200, { ok: true });
        }

        // Resolução de produto: o NAVEGADOR nunca abre a loja — manda o link para cá e o servidor resolve.
        if (route === 'POST /api/import' || route === 'POST /api/perfumes/resolve') {
          const { url: link, identity, variantId } = await readJson(req, importSchema);
          const release = acquireResearch();
          res.on('close', release);
          res.on('finish', release);
          res.writeHead(200, { ...API_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          const outcome = await importFromUrl(link, identity ?? null, (stage) => res.write(`${JSON.stringify({ stage })}\n`), variantId ?? null);
          res.end(`${JSON.stringify({ outcome })}\n`);
          return;
        }

        if (route === 'POST /api/photo') {
          if (!/^image\/(png|jpe?g|webp|avif|gif)$/i.test(String(req.headers['content-type'] ?? ''))) {
            throw new HttpError(415, 'unsupported', 'Envie uma foto em JPG, PNG ou WebP.');
          }
          const buffer = await readBody(req, 15 * 1024 * 1024);
          // O tipo declarado pode mentir: vale o conteúdo. SVG nunca.
          if (!checkImageBytes(buffer, String(req.headers['content-type'] ?? '')).ok) {
            throw new HttpError(415, 'unsupported', 'Envie uma foto em JPG, PNG ou WebP.');
          }
          try {
            const release = acquireResearch();
            const media = await saveBottleMedia(await processBottleImage(buffer)).finally(release);
            return sendJson(res, 200, { media });
          } catch (error) {
            event('image.error', { origin: 'upload', reason: (error as Error).message }, 'warn');
            throw new HttpError(422, 'bad_image', 'Não consegui abrir essa imagem. Tente outra foto.');
          }
        }

        if (route === 'GET /api/events') {
          res.writeHead(200, { ...API_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
          res.write(`event: revision\ndata: ${await repo.revision()}\n\n`);
          const off = repo.subscribe((revision) => res.write(`event: revision\ndata: ${revision}\n\n`));
          const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
          req.on('close', () => {
            off();
            clearInterval(ping);
          });
          return;
        }
        throw new HttpError(404, 'not_found', 'Rota não encontrada.');
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'Método não suportado.');

      if (url.pathname.startsWith('/media/')) {
        const rel = url.pathname.slice('/media/'.length);
        // Foto de perfume de uma lista pública pode ser vista sem código de acesso; o resto, não.
        const isPublic = await repo.isPublicMedia(`media/${rel}`);
        if (!isPublic) requireAuthorized(req);
        // O armazenamento recusa chave com "..", barra inicial ou caractere estranho, e confere a pasta de novo.
        const object = await media.get(rel);
        if (!object) throw new HttpError(404, 'not_found', 'Imagem não encontrada.');
        return serveBuffer(res, object.body, object.contentType, `${isPublic ? 'public' : 'private'}, max-age=31536000, immutable`);
      }

      // index.html é servido pelo próprio app, com uma marca: a página sabe que tem servidor e nunca "desce" para o
      // modo só-navegador (que não abre links) só porque uma resposta demorou.
      if (url.pathname === '/' || url.pathname === '/index.html') return serveIndex(res);
      // Endereços públicos (/username, /username/wishlist, /username/collection): mesmo app, com metadados da página.
      const publicRoute = parsePublicRoute(url.pathname);
      if (publicRoute) return serveIndex(res, await publicPageMeta(publicRoute, originFor(req.headers.host), repo));
      const decoded = decodePath(url.pathname);
      const asset = url.pathname !== '/' && decoded !== null && inside(config.distDir, decoded);
      // sw.js sem cache longo: uma versão nova do service worker precisa chegar no próximo acesso.
      if (asset) return serveFile(res, asset, url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : url.pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600');
      return serveIndex(res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      log.error({ event: 'server.error', err: error, route: `${req.method} ${safePath(req.url)}` });
      return sendJson(res, 500, { error: { code: 'internal', message: 'Algo deu errado aqui. Tente de novo.' } });
    }
  };
}
