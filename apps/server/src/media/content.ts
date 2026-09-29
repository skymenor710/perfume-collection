import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { event } from '../log';
import type { SeedRefs } from '../repositories/rules';
import { isContentKey, matchesContentKey } from '../storage/keys';
import { R2StorageProvider } from '../storage/r2';
import type { StorageProvider } from '../storage/types';
import { MediaMap } from './map';

/**
 * Onde as fotos moram e como uma referência vira arquivo ou endereço (FASE 3). Um lugar só para:
 *   - o modo ativo (MEDIA_BACKEND=local|r2) e o fallback (MEDIA_FALLBACK=none|local);
 *   - referência local ("bottles/…", "media/…") → arquivo no disco;
 *   - chave por conteúdo ("p/…") → arquivo local de origem, conferido pelo SHA-256 (via mapa);
 *   - endereço público de uma imagem (Open Graph) e a origem liberada no CSP.
 */

export interface MediaSettings {
  backend: 'local' | 'r2';
  fallback: 'none' | 'local';
  /** O R2 (ou um falso nos testes). Nulo no modo local. */
  remote: StorageProvider | null;
  map: MediaMap;
}

let current: MediaSettings | null = null;
let currentFor = '';

/** Configuração ativa (refeita se o ambiente mudar — testes recarregam a config). */
export function mediaSettings(): MediaSettings {
  const r2 = config.r2;
  const signature = `${config.mediaBackend}|${config.mediaFallback}|${config.mediaMapFile}|${r2 ? `${r2.endpoint}|${r2.bucket}|${r2.publicBaseUrl}` : ''}`;
  if (current && currentFor === signature) return current;
  const backend = config.mediaBackend;
  // parseEnv já garante R2 completo com MEDIA_BACKEND=r2.
  current = { backend, fallback: config.mediaFallback, remote: backend === 'r2' && r2 ? new R2StorageProvider(r2) : null, map: new MediaMap(config.mediaMapFile) };
  currentFor = signature;
  return current;
}

/* ------------------------------------------------------------------ arquivos locais */

/** "bottles/…" mora no site (apps/web/public, cópia em dist); "media/…" nos dados. Nada fora dessas pastas. */
export function localFileForRef(ref: string): string | null {
  const roots: [string, string[]][] = [
    ['bottles/', [path.join(config.root, 'apps', 'web', 'public'), config.distDir]],
    ['media/', [config.dataDir]],
  ];
  for (const [prefix, dirs] of roots) {
    if (!ref.startsWith(prefix)) continue;
    let first: string | null = null;
    for (const root of dirs) {
      const file = path.resolve(root, ref);
      if (!file.startsWith(path.resolve(root) + path.sep)) return null;
      first ??= file;
      if (existsSync(file)) return file;
    }
    return first;
  }
  return null;
}

/** Arquivos já conferidos (caminho + data + tamanho): a foto é lida e hasheada uma vez, não a cada pedido. */
const verified = new Map<string, string>();

/**
 * Arquivo local de uma chave por conteúdo: a primeira referência antiga do mapa cujo arquivo existe E tem exatamente
 * o SHA-256 da chave. Arquivo trocado depois da migração não serve (não é a mesma foto).
 */
export function localFileForKey(key: string, map: MediaMap): { file: string; ref: string } | null {
  if (!isContentKey(key)) return null;
  for (const ref of map.originalsFor(key)) {
    const file = localFileForRef(ref);
    if (!file || !existsSync(file)) continue;
    const info = statSync(file);
    const stamp = `${file}|${info.mtimeMs}|${info.size}`;
    if (verified.get(stamp) === key || matchesContentKey(key, readFileSync(file))) {
      verified.set(stamp, key);
      return { file, ref };
    }
  }
  return null;
}

/**
 * Referências em uso + os arquivos locais de origem de cada chave por conteúdo em uso. A limpeza de órfãos
 * (media/gc.ts, só no disco local — nunca no R2) não pode levar a cópia que garante a volta.
 * Mapa ilegível lança erro: a limpeza para, em vez de apagar com informação incompleta.
 */
export function referencedWithOriginals(referenced: ReadonlySet<string>, map: MediaMap): Set<string> {
  const out = new Set(referenced);
  for (const ref of referenced) if (isContentKey(ref)) for (const original of map.originalsFor(ref)) out.add(original);
  return out;
}

/** Arquivo de qualquer referência de imagem do app (local ou por conteúdo). */
export function resolveImageRef(ref: string, map: MediaMap = mediaSettings().map): string | null {
  if (isContentKey(ref)) return localFileForKey(ref, map)?.file ?? null;
  return localFileForRef(ref);
}

/* ------------------------------------------------------------------ endereços */

/** Origem das imagens do R2 (a ÚNICA liberada no CSP além do app), ou nulo no modo local. */
export function remoteImageOrigin(settings: MediaSettings): string | null {
  if (settings.backend !== 'r2' || !settings.remote) return null;
  try {
    return new URL(settings.remote.publicUrl('p/probe.webp')).origin;
  } catch {
    return null;
  }
}

/** img-src do CSP: igual ao de sempre no modo local; + a origem pública do R2 no modo r2. */
export function imgSrc(settings: MediaSettings): string {
  const origin = remoteImageOrigin(settings);
  return `'self' data: blob:${origin ? ` ${origin}` : ''}`;
}

export function contentSecurityPolicy(settings: MediaSettings): string {
  return `default-src 'self'; img-src ${imgSrc(settings)}; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}

/**
 * Endereço absoluto de uma imagem para fora do app (Open Graph): chave validada no R2 com MEDIA_BACKEND=r2 → URL
 * pública do R2; o resto → pelo próprio servidor (que resolve /p/… com a cópia local ou redireciona).
 */
export function absoluteImageUrl(ref: string, origin: string, settings: MediaSettings): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (isContentKey(ref) && settings.backend === 'r2' && settings.remote && settings.map.isValidated(ref)) return settings.remote.publicUrl(ref);
  return `${origin}/${ref}`;
}

/* ------------------------------------------------------------------ servir /p/… */

export type ContentRoute =
  | { kind: 'redirect'; location: string }
  | { kind: 'local'; file: string; fallback: boolean }
  | { kind: 'missing'; reason: 'not_migrated' | 'no_local_copy' };

/**
 * Como servir uma chave por conteúdo. Regras (docs/R2.md, "fallback"):
 *   - r2 + validada no mapa → redireciona para o R2;
 *   - r2 + NÃO validada → só com MEDIA_FALLBACK=local serve a cópia local (conferida), com log de aviso; senão 404 e
 *     log de erro — objeto ausente no R2 nunca some calado atrás da cópia local;
 *   - local → a cópia local conferida pelo SHA-256 (é o caminho de volta sem reescrever o banco).
 */
export function routeContentKey(key: string, settings: MediaSettings): ContentRoute {
  if (settings.backend === 'r2' && settings.remote) {
    if (settings.map.isValidated(key)) return { kind: 'redirect', location: settings.remote.publicUrl(key) };
    if (settings.fallback !== 'local') {
      event('media.not_migrated', { key }, 'error');
      return { kind: 'missing', reason: 'not_migrated' };
    }
    const local = localFileForKey(key, settings.map);
    event('media.fallback', { key, served: local ? 'local' : 'nada' }, 'warn');
    return local ? { kind: 'local', file: local.file, fallback: true } : { kind: 'missing', reason: 'no_local_copy' };
  }
  const local = localFileForKey(key, settings.map);
  return local ? { kind: 'local', file: local.file, fallback: false } : { kind: 'missing', reason: 'no_local_copy' };
}

/* ------------------------------------------------------------------ semente */

/** A semente vista através do mapa: chave por conteúdo que veio de "bottles/…" continua sendo foto da semente. */
export function seedRefs(settings: MediaSettings): SeedRefs {
  const data = settings.map.read();
  const keyOf = (ref: string | null) => {
    if (!ref) return null;
    if (isContentKey(ref)) return ref;
    const hit = data.refs[ref];
    return hit && data.objects[hit.key]?.status === 'validated' ? hit.key : null;
  };
  return {
    isSeedPhoto: (ref) => {
      if (!ref) return false;
      if (ref.startsWith('bottles/')) return true;
      if (!isContentKey(ref)) return false;
      return Object.entries(data.refs).some(([orig, r]) => r.key === ref && orig.startsWith('bottles/'));
    },
    same: (a, b) => a === b || (keyOf(a) !== null && keyOf(a) === keyOf(b)),
    stored: (ref) => (settings.backend === 'r2' ? (keyOf(ref) ?? ref) : ref),
  };
}
