import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isContentKey } from '../storage/keys';

/**
 * Mapa de migração das fotos (FASE 3): referência antiga ("bottles/…", "media/…") → SHA-256 → chave no R2
 * ("p/<sha256>.<formato>"). É a memória da migração: diz o que já está no R2 e COMPROVADO, evita subir de novo,
 * permite voltar uma referência para o arquivo local e auditar tudo depois.
 *
 * Decisão (docs/R2.md, ADR 0012): arquivo JSON nos dados (data/media-map.json), não tabela no banco — nesta fase o
 * schema do Postgres não muda (uma migration pendente faria o app recusar a partida). O arquivo entra no db:backup.
 *
 * Regras:
 *   - só `objects[key].status = "validated"` conta como migrado — e só é gravado DEPOIS de baixar o objeto de volta e o
 *     SHA-256 bater (media/migrate.ts). Upload sem prova não entra no mapa;
 *   - várias referências podem apontar para a mesma chave (mesmo conteúdo = um objeto só);
 *   - `journal` guarda cada troca de referência feita no banco (virada e volta), com o lugar exato de cada uma — a volta
 *     não depende de adivinhar pelo nome do arquivo;
 *   - arquivo ilegível é ERRO, nunca "mapa vazio" (vazio esconderia uma migração feita);
 *   - gravação atômica (arquivo temporário + rename) sob trava de arquivo: dois processos não perdem atualização.
 */

export type RefField = 'url' | 'thumbUrl' | 'masterUrl' | 'avatarUrl';

/** Um lugar da biblioteca que guarda uma referência de imagem. */
export interface RefLocation {
  productId: string | null;
  imageIndex: number | null;
  userId: string | null;
  field: RefField;
}

export interface RefChange extends RefLocation {
  from: string;
  to: string;
}

const objectSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  contentType: z.string(),
  status: z.literal('validated'),
  validatedAt: z.string(),
  storage: z.string(),
});
const refSchema = z.object({ key: z.string().refine(isContentKey), sha256: z.string().regex(/^[0-9a-f]{64}$/), recordedAt: z.string() });
const changeSchema = z.object({
  productId: z.string().nullable(),
  imageIndex: z.number().int().nullable(),
  userId: z.string().nullable(),
  field: z.enum(['url', 'thumbUrl', 'masterUrl', 'avatarUrl']),
  from: z.string(),
  to: z.string(),
});
const mapSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  objects: z.record(z.string().refine(isContentKey), objectSchema),
  refs: z.record(z.string(), refSchema),
  journal: z.array(z.object({ at: z.string(), kind: z.enum(['cutover', 'rollback']), changes: z.array(changeSchema) })),
});

export type MapObject = z.infer<typeof objectSchema>;
export type MapRef = z.infer<typeof refSchema>;
export type MediaMapData = z.infer<typeof mapSchema>;

export const emptyMap = (): MediaMapData => ({ version: 1, updatedAt: new Date(0).toISOString(), objects: {}, refs: {}, journal: [] });

export class MediaMapError extends Error {}

/* ---- leitura (funções puras sobre os dados) ---- */

export const isValidated = (data: MediaMapData, key: string) => data.objects[key]?.status === 'validated';

/** Chave validada para uma referência antiga, ou nulo (não migrada ou sem prova). */
export function validatedKeyFor(data: MediaMapData, ref: string): string | null {
  const hit = data.refs[ref];
  return hit && isValidated(data, hit.key) ? hit.key : null;
}

/** Todas as referências antigas que viraram esta chave (ordem estável). */
export function originalsFor(data: MediaMapData, key: string): string[] {
  return Object.entries(data.refs)
    .filter(([, r]) => r.key === key)
    .map(([ref]) => ref)
    .sort();
}

/* ---- arquivo ---- */

interface MapOptions {
  /** Espera máxima pela trava (padrão 15 s). */
  lockTimeoutMs?: number;
  /** Trava mais velha que isso é de um processo que morreu (padrão 60 s). */
  staleLockMs?: number;
}

/** Fila por arquivo dentro do mesmo processo: evita disputar a trava consigo mesmo. */
const queues = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Códigos do Windows para "arquivo sendo trocado/apagado por outro processo agora": momentâneos, repetir. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Repete uma leitura síncrona que esbarrou num rename/unlink de outro processo (Windows), por até ~1 s. */
function retrySync<T>(read: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return read();
    } catch (error) {
      if (attempt >= 50 || !BUSY.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

export class MediaMap {
  private cache: { mtimeMs: number; size: number; data: MediaMapData } | null = null;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(
    readonly file: string,
    options: MapOptions = {},
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? 15_000;
    this.staleLockMs = options.staleLockMs ?? 60_000;
  }

  /** Estado atual do arquivo (cache pela data/tamanho). Sem arquivo = mapa vazio; arquivo ilegível = erro. */
  read(): MediaMapData {
    if (!existsSync(this.file)) return emptyMap();
    const info = retrySync(() => statSync(this.file));
    if (this.cache && this.cache.mtimeMs === info.mtimeMs && this.cache.size === info.size) return this.cache.data;
    let text: string;
    try {
      text = retrySync(() => readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new MediaMapError(`Mapa de migração não pôde ser lido (${(error as NodeJS.ErrnoException).code ?? 'erro'}): nada foi assumido.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MediaMapError(`Mapa de migração ilegível (${path.basename(this.file)}): nada foi assumido. Restaure do backup.`);
    }
    const result = mapSchema.safeParse(parsed);
    if (!result.success) throw new MediaMapError(`Mapa de migração inválido (${path.basename(this.file)}): ${result.error.issues[0]?.path.join('.') ?? '?'}. Nada foi assumido.`);
    this.cache = { mtimeMs: info.mtimeMs, size: info.size, data: result.data };
    return result.data;
  }

  validatedKeyFor(ref: string) {
    return validatedKeyFor(this.read(), ref);
  }

  originalsFor(key: string) {
    return originalsFor(this.read(), key);
  }

  isValidated(key: string) {
    return isValidated(this.read(), key);
  }

  /**
   * Lê o arquivo MAIS RECENTE, aplica `change` e grava — tudo sob trava. `change` recebe uma cópia; se lançar erro,
   * nada é gravado.
   */
  update(change: (data: MediaMapData) => void): Promise<MediaMapData> {
    const previous = queues.get(this.file) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.locked(change));
    queues.set(this.file, run);
    return run;
  }

  private async locked(change: (data: MediaMapData) => void): Promise<MediaMapData> {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const release = await this.acquire();
    try {
      this.cache = null;
      const data = structuredClone(this.read());
      change(data);
      data.updatedAt = new Date().toISOString();
      const valid = mapSchema.parse(data);
      const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(valid, null, 2)}\n`);
      await this.replace(tmp);
      this.cache = null;
      return valid;
    } finally {
      release();
    }
  }

  /** rename por cima (no Windows pode falhar por um instante se alguém estiver lendo). */
  private async replace(tmp: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, this.file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 40 || !BUSY.has(code ?? '')) {
          try {
            unlinkSync(tmp);
          } catch {
            /* já foi */
          }
          throw error;
        }
        await sleep(25);
      }
    }
  }

  private async acquire(): Promise<() => void> {
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const fd = openSync(lock, 'wx');
        writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
        closeSync(fd);
        return () => {
          try {
            retrySync(() => unlinkSync(lock));
          } catch {
            /* já liberada (ou presa demais: vira trava abandonada, retomada pelo tempo) */
          }
        };
      } catch (error) {
        // EEXIST: trava de outro. No Windows, trava sendo apagada ("exclusão pendente") responde EPERM/EACCES/EBUSY:
        // também é "ocupado, tente de novo" — não é erro.
        if (!BUSY.has((error as NodeJS.ErrnoException).code ?? '') && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lock).mtimeMs > this.staleLockMs) unlinkSync(lock);
        } catch {
          /* sumiu entre o stat e o unlink */
        }
        if (Date.now() > deadline) throw new MediaMapError('Mapa de migração ocupado por outro processo (trava não liberada). Nada foi gravado.');
        await sleep(15 + Math.random() * 35);
      }
    }
  }
}
