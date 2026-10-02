import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { vi } from 'vitest';
import type { Library } from '@perfumes/core/library';
import { reloadConfig } from '../../apps/server/src/config';
import { MediaMap } from '../../apps/server/src/media/map';
import type { MediaSettings } from '../../apps/server/src/media/content';
import type { PublicFetch } from '../../apps/server/src/media/smoke';
import { OWNER } from './db';
import type { FakeR2StorageProvider } from './fake-r2';

/**
 * Ambiente e dados de mentira para os testes de mídia (FASE 3.1). Nada aqui toca a rede, o Neon ou o .env.local:
 * pasta de dados temporária, imagens de verdade geradas na hora (sharp, 6×6 px) e um R2 falso em memória.
 */

export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface TempData {
  dataDir: string;
  work: string;
  /** Grava em <dataDir>/media/<name> e devolve a referência "media/<name>". */
  writeMedia(name: string, body: Buffer): string;
  newMap(): MediaMap;
}

/** Aponta a configuração para pastas temporárias (e limpa as variáveis MEDIA_ e R2_ do ambiente do teste). */
export function setupTempData(prefix: string): TempData {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), `perfumes-${prefix}-`));
  const work = mkdtempSync(path.join(os.tmpdir(), `perfumes-${prefix}-work-`));
  process.env.PERFUMES_DATA_DIR = dataDir;
  process.env.PERFUMES_HOST = '127.0.0.1';
  process.env.PERFUMES_ACCESS_CODE = 'TESTE1';
  process.env.LOG_LEVEL = 'silent';
  for (const k of Object.keys(process.env)) if (/^(MEDIA_|R2_)/.test(k)) delete process.env[k];
  reloadConfig();
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  let count = 0;
  return {
    dataDir,
    work,
    writeMedia(name, body) {
      writeFileSync(path.join(dataDir, 'media', name), body);
      return `media/${name}`;
    },
    newMap: () => new MediaMap(path.join(work, `map-${++count}.json`)),
  };
}

let color = 0;
/** Imagem de verdade, com uma cor diferente a cada chamada: conteúdo único. */
export async function image(format: 'webp' | 'png' = 'webp', rgb?: [number, number, number]): Promise<Buffer> {
  color++;
  const [r, g, b] = rgb ?? [(color * 37) % 256, (color * 91) % 256, (color * 53) % 256];
  const img = sharp({ create: { width: 6, height: 6, channels: 4, background: { r, g, b, alpha: 1 } } });
  return format === 'png' ? img.png().toBuffer() : img.webp({ lossless: true }).toBuffer();
}

export const settingsFor = (backend: 'local' | 'r2', remote: FakeR2StorageProvider | null, map: MediaMap, fallback: 'none' | 'local' = 'none'): MediaSettings => ({ backend, fallback, remote, map });

/** Biblioteca mínima: um produto por entrada, com a foto principal (e miniatura/master se dadas). */
export function tinyLibrary(images: { product: string; url: string; thumbUrl?: string | null; masterUrl?: string | null }[], avatar: string | null = null): Library {
  return {
    schemaVersion: 2,
    users: [{ ...OWNER, avatarUrl: avatar }],
    products: images.map((i) => ({ id: i.product, images: [{ role: 'main', url: i.url, thumbUrl: i.thumbUrl ?? null, masterUrl: i.masterUrl ?? null, variantId: null, transparent: true, source: null, credit: null }] })),
    entries: [],
  } as unknown as Library;
}

/** Resolvedor de teste: "media/…" dentro da pasta de dados temporária. */
export const mediaResolver = (dataDir: string) => (ref: string) => (/^(bottles|media)\//.test(ref) ? path.join(dataDir, ...ref.split('/')) : null);

/**
 * Armadilha de rede: troca o `fetch` global. Só o laço local (http://127.0.0.1…, onde moram os servidores falsos dos testes)
 * passa; qualquer outro destino é ANOTADO em `offending` e derruba a chamada. Cada teste confere `offending` vazio no fim.
 */
export function networkTrap() {
  const original = globalThis.fetch;
  const offending: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, 'http://invalido.test').origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/)) return original(input, init);
    offending.push(new URL(url, 'http://invalido.test').protocol + '//…');
    throw new Error('REDE PROIBIDA NO TESTE');
  }) as typeof fetch);
  return { offending, restore: () => spy.mockRestore() };
}

/** A URL pública "serve" o que está no R2 falso, como um bucket público de verdade serviria. */
export const servePublic =
  (remote: FakeR2StorageProvider): PublicFetch =>
  async (url) => {
    const object = remote.objects.get(new URL(url).pathname.slice(1));
    return object ? new Response(new Uint8Array(object.body), { status: 200 }) : new Response('não encontrado', { status: 404 });
  };
