import type { IncomingMessage } from 'node:http';
import type { HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Perfume } from '@perfumes/core/perfume';
import type { ImportJob } from '../jobs/types';
import type { ImportJobRunner } from '../jobs/runner';
import { log, safePath } from '../log';
import type { LibraryRepository } from '../repositories/library';
import { sourcesStatus } from '../sources/registry';
import { HttpError } from './guard';

/**
 * API versionada (/api/v1), em Hono, montada DENTRO do servidor atual: Host, mesma origem e tamanho de corpo já
 * foram conferidos antes de chegar aqui, e as rotas antigas (/api/…) continuam idênticas.
 *
 * Autorização passa por uma função (`Authorizer`) que devolve QUEM está pedindo. Hoje: o computador (localhost) ou
 * um aparelho pareado pelo código — sempre o único usuário. Com contas (FASE 3), o Better Auth entra aqui e cada
 * rota já usa `principal.userId`: nenhuma rota lê "o usuário" de outro lugar.
 */

export interface Principal {
  userId: string;
  via: 'loopback' | 'device' | 'session';
}

export type Authorizer = (req: IncomingMessage) => Principal | null;

export interface V1Deps {
  repo: LibraryRepository;
  jobs: ImportJobRunner;
  authorize: Authorizer;
}

type Env = { Bindings: HttpBindings; Variables: { principal: Principal } };

const ERROR_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

const importSchema = z.object({
  url: z.string().min(4).max(2048),
  identity: z.object({ brand: z.string().max(80).optional(), name: z.string().min(1).max(140) }).optional(),
  variantId: z.string().min(1).max(80).optional(),
});
const retrySchema = z.object({ variantId: z.string().min(1).max(80).nullable().optional() });
const meSchema = z.object({
  username: z.string().min(1).max(40).optional(),
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(280).nullable().optional(),
  privacy: z
    .object({ profile: z.enum(['public', 'private']).optional(), wishlist: z.enum(['public', 'private']).optional(), collection: z.enum(['public', 'private']).optional() })
    .optional(),
});
const idSchema = z.string().regex(/^[\w-]{1,80}$/);

async function body<T>(c: Context<Env>, schema: z.ZodType<T>, optional = false): Promise<T> {
  const type = c.req.header('content-type') ?? '';
  if (!/application\/json/i.test(type)) {
    if (optional) return schema.parse({});
    throw new HttpError(415, 'unsupported', 'Formato não suportado.');
  }
  const text = await c.req.text();
  if (text.length > 64 * 1024) throw new HttpError(413, 'too_large', 'O pedido é grande demais.');
  let raw: unknown;
  try {
    raw = JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'bad_json', 'Formato inválido.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, 'invalid', 'Confira os dados enviados.');
  return parsed.data;
}

/** O que um job mostra para fora: sem o dono (já é quem pede). */
function publicJob(job: ImportJob) {
  const { ownerId: _owner, ...rest } = job;
  return rest;
}

const inList = (list: 'wishlist' | 'collection') => (p: Perfume) => (list === 'collection' ? p.status === 'owned' : p.status !== 'owned');

export function createV1(deps: V1Deps) {
  const app = new Hono<Env>().basePath('/api/v1');

  app.use('*', async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(ERROR_HEADERS)) if (!c.res.headers.has(k)) c.res.headers.set(k, v);
  });

  // Corpo de pedido limitado a 64 KB, conferido enquanto chega (não depois de ler tudo).
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new HttpError(413, 'too_large', 'O pedido é grande demais.'); } }));

  // Público: saúde do serviço (para monitor de disponibilidade). Não diz nada da coleção.
  app.get('/health', (c) => c.json({ ok: true, api: 'v1' }));

  // Daqui para baixo, só com autorização.
  app.use('*', async (c, next) => {
    const principal = deps.authorize(c.env.incoming);
    if (!principal) throw new HttpError(401, 'pairing_required', 'Digite o código de acesso que aparece no computador.');
    c.set('principal', principal);
    await next();
  });

  /* ------------------------------------------------------------ perfil */
  app.get('/me', (c) => c.json({ user: deps.repo.me() }));
  app.patch('/me', async (c) => {
    const patch = await body(c, meSchema);
    try {
      return c.json({ user: deps.repo.updateMe(patch) });
    } catch (error) {
      throw new HttpError(422, 'invalid', (error as Error).message);
    }
  });

  /* ------------------------------------------------------------ coleção (leitura; a escrita segue nas rotas atuais) */
  app.get('/perfumes', (c) => c.json({ revision: deps.repo.revision(), perfumes: deps.repo.list() }));
  app.get('/perfumes/:id', (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const perfume = id.success ? deps.repo.list().find((p) => p.id === id.data) : undefined;
    if (!perfume) throw new HttpError(404, 'not_found', 'Esse perfume não está na coleção.');
    return c.json({ perfume });
  });
  app.get('/wishlist', (c) => c.json({ revision: deps.repo.revision(), perfumes: deps.repo.list().filter(inList('wishlist')) }));
  app.get('/collection', (c) => c.json({ revision: deps.repo.revision(), perfumes: deps.repo.list().filter(inList('collection')) }));

  /* ------------------------------------------------------------ importação por job */
  app.post('/imports', async (c) => {
    const input = await body(c, importSchema);
    const { job, deduplicated } = await deps.jobs.create(c.get('principal').userId, {
      url: input.url,
      identity: input.identity ?? null,
      variantId: input.variantId ?? null,
    });
    return c.json({ job: publicJob(job), deduplicated }, deduplicated ? 200 : 202, { Location: `/api/v1/imports/${job.id}` });
  });
  app.get('/imports', async (c) => c.json({ jobs: (await deps.jobs.list(c.get('principal').userId, 50)).map(publicJob) }));
  app.get('/imports/:id', async (c) => {
    const job = await deps.jobs.get(c.get('principal').userId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'not_found', 'Importação não encontrada.');
    return c.json({ job: publicJob(job) });
  });
  app.delete('/imports/:id', async (c) => {
    const job = await deps.jobs.cancel(c.get('principal').userId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'not_found', 'Importação não encontrada.');
    return c.json({ job: publicJob(job) });
  });
  app.post('/imports/:id/retry', async (c) => {
    const patch = await body(c, retrySchema, true);
    const job = await deps.jobs.retry(c.get('principal').userId, c.req.param('id'), patch.variantId === undefined ? {} : { variantId: patch.variantId });
    if (!job) throw new HttpError(404, 'not_found', 'Importação não encontrada.');
    if (job === 'not_retryable') throw new HttpError(409, 'not_retryable', 'Essa importação ainda está em andamento ou já terminou bem.');
    return c.json({ job: publicJob(job) }, 202);
  });
  // Progresso ao vivo (Server-Sent Events): estado atual na hora e a cada mudança; fecha quando termina.
  app.get('/imports/:id/events', async (c) => {
    const userId = c.get('principal').userId;
    const first = await deps.jobs.get(userId, c.req.param('id'));
    if (!first) throw new HttpError(404, 'not_found', 'Importação não encontrada.');
    const id = first.id;
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (job: ImportJob) => {
          try {
            controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`));
          } catch {
            /* fluxo já fechado */
          }
          if (job.status !== 'queued' && job.status !== 'running') {
            cleanup();
            try {
              controller.close();
            } catch {
              /* já fechado */
            }
          }
        };
        const off = deps.jobs.subscribe(id, send);
        const ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            cleanup();
          }
        }, 25_000);
        cleanup = () => {
          off();
          clearInterval(ping);
        };
        // Estado atual depois de assinar: nenhuma mudança se perde entre as duas coisas.
        void deps.jobs.get(userId, id).then((job) => job && send(job));
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  });

  /* ------------------------------------------------------------ fontes (diagnóstico) */
  app.get('/sources', (c) => c.json({ sources: sourcesStatus() }));

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Rota não encontrada.' } }, 404));

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    log.error({ event: 'server.error', err: error, route: `${c.req.method} ${safePath(c.req.path)}` });
    return c.json({ error: { code: 'internal', message: 'Algo deu errado aqui. Tente de novo.' } }, 500);
  });

  return app;
}
