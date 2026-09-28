import { guessFromUrl, type SlugGuess } from '@perfumes/core/normalize';
import { sanitizePerfume, sortPerfumes, type FieldSource, type Gender, type ImageSource, type OlfactoryProfile, type Perfume } from '@perfumes/core/perfume';
import { blobToDataUrl, processPhoto } from '../lib/photo';
import { apiPath } from '../lib/refs';
import { parsePublicPath } from '@perfumes/core/library';
import { capability, claudeRuntime, errorCode, type Assets, type Db } from './claude';

/**
 * Onde a coleção mora — a interface não sabe e não precisa saber:
 * - `server`: `npm start` no computador (e o celular na mesma rede). Importa links de verdade.
 * - `artifact`: o link do claude.ai. Guarda na conta; link vira palpite pelo endereço + foto enviada.
 * - `local`: sem servidor e fora do claude.ai (arquivo aberto, `npm run dev` sem API). Guarda no navegador.
 */

export type Mode = 'server' | 'artifact' | 'local' | 'public';

/** Quem é o dono de uma página pública (/username) e quais listas ele abriu. */
export interface PublicOwner {
  username: string;
  displayName: string;
  bio: string | null;
  lists: ('wishlist' | 'collection')[];
  /** Lista pedida no endereço (/username/wishlist), ou nula no perfil. */
  focus: 'wishlist' | 'collection' | null;
}

export interface PhotoMedia {
  imageUrl: string;
  thumbUrl: string;
  /** PNG mestre 2048×2048 transparente (só o servidor guarda). */
  masterUrl?: string;
  dominantColor: string;
  cutout: boolean;
}

/** Etapas do resolvedor "produto primeiro" (apps/server/src/resolver/resolve.ts). 'fallback' = o site do link não deixou ler. */
export type ImportStage = 'link' | 'identity' | 'fallback' | 'search' | 'compare' | 'images' | 'bottle' | 'notes' | 'final' | 'done';

/** Uma versão do produto para a pergunta "qual versão?" — tamanho, preço e foto da MESMA variante. */
export interface VariantOption {
  id: string;
  label: string;
  volume: string | null;
  volumeMl: number | null;
  price: number | null;
  currency: string | null;
  sku: string | null;
  available: boolean | null;
  url: string | null;
  /** Miniatura do frasco desta variante (data URL), quando a loja tem foto dela. */
  thumb: string | null;
}

/** O servidor identificou o produto e ele tem mais de uma versão: a pessoa escolhe antes de continuar. */
export interface VariantQuestion {
  brand: string;
  name: string;
  concentration: string | null;
  variants: VariantOption[];
  preselectedId: string | null;
  sourceLabel: string | null;
}

/** Quando o sistema não reconheceu o perfume, a pessoa diz qual é — só a identidade, nunca o formulário todo. */
export interface IdentityHint {
  brand?: string;
  name: string;
}

export interface ImportedDraft {
  name: string | null;
  brand: string | null;
  description: string | null;
  concentration: string | null;
  volume: string | null;
  gender: Gender | null;
  price: number | null;
  currency: string | null;
  sourceUrl: string;
  media: PhotoMedia | null;
  imageCredit: string | null;
  imageSource: ImageSource | null;
  accentColor: string | null;
  accentGlow: string | null;
  olfactoryProfile: OlfactoryProfile | null;
  fieldSources: Record<string, FieldSource>;
  variant: VariantOption | null;
  variants: VariantOption[];
  variantUrl: string | null;
  /** high: entra direto na wishlist; moderate: a pessoa confirma numa prévia. */
  confidence: 'high' | 'moderate';
}

export type ImportOutcome =
  | { ok: true; perfume: ImportedDraft; notes: string[] }
  | ({ ok: 'choose' } & VariantQuestion)
  | { ok: false; code: 'invalid_url' | 'unidentified' | 'no_reader'; message: string; guess: Partial<SlugGuess> | null; sourceUrl?: string | null };

export interface Repository {
  mode: Mode;
  /** Só em página pública: de quem é a coleção vista. */
  owner?: () => PublicOwner | null;
  /** Abre a página da loja e lê o produto (só o servidor consegue). */
  canReadLinks: boolean;
  canWrite: boolean;
  subscribe(onList: (list: Perfume[]) => void, onError: (message: string) => void): () => void;
  save(perfume: Perfume): Promise<void>;
  remove(perfume: Perfume): Promise<void>;
  importLink(url: string, onStage: (stage: ImportStage) => void, identity?: IdentityHint | null, variantId?: string | null): Promise<ImportOutcome>;
  uploadPhoto(file: Blob): Promise<PhotoMedia>;
  /** Pesquisa de novo fotos e perfil olfativo (só no computador). */
  refresh?(perfume: Perfume, onStage: (stage: ImportStage) => void, variantId?: string | null): Promise<{ perfume: Perfume } | { choose: VariantQuestion }>;
}

export class FriendlyError extends Error {}

const clean = (list: unknown[]) => sortPerfumes(list.map(sanitizePerfume).filter((p): p is Perfume => p !== null));

/** Sem leitor de páginas: o endereço vira palpite e a pessoa confirma. Nunca finge que leu a loja. */
function guessOnly(url: string): ImportOutcome {
  let valid: string | null = null;
  try {
    const u = new URL(url.trim());
    if (u.protocol === 'https:' || u.protocol === 'http:') valid = u.toString();
  } catch {
    /* inválido */
  }
  if (!valid) return { ok: false, code: 'invalid_url', message: 'Esse endereço não parece um link de página. Confira se copiou o link inteiro.', guess: guessFromUrl(''), sourceUrl: null };
  return {
    ok: false,
    code: 'no_reader',
    message: 'Aqui eu não consigo abrir a página da loja — completei o que dá para ler no próprio link.',
    guess: guessFromUrl(valid),
    sourceUrl: valid,
  };
}

/* ---------------------------------------------------------------- servidor */

/** Linhas JSON do servidor, uma por evento de progresso. */
async function readNdjson<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...(init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  } catch {
    throw new FriendlyError('Sem conexão com o computador. Confira se o `npm start` continua aberto.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new FriendlyError(data?.error?.message ?? 'Algo deu errado. Tente de novo.');
  return data as T;
}

export function serverRepository(): Repository {
  return {
    mode: 'server',
    canReadLinks: true,
    canWrite: true,
    subscribe(onList, onError) {
      let alive = true;
      const load = () =>
        api<{ perfumes: unknown[] }>(apiPath('api/perfumes'))
          .then((d) => alive && onList(clean(d.perfumes)))
          .catch((e) => alive && onError((e as Error).message));
      load();
      // Outro aparelho mudou algo? O servidor avisa e a lista recarrega.
      const events = new EventSource(apiPath('api/events'));
      let first = true;
      events.addEventListener('revision', () => {
        if (first) {
          first = false;
          return;
        }
        load();
      });
      return () => {
        alive = false;
        events.close();
      };
    },
    async save(perfume) {
      await api(apiPath(`api/perfumes/${encodeURIComponent(perfume.id)}`), { method: 'PUT', body: JSON.stringify(perfume) });
    },
    async remove(perfume) {
      await api(apiPath(`api/perfumes/${encodeURIComponent(perfume.id)}`), { method: 'DELETE' });
    },
    async importLink(url, onStage, identity, variantId) {
      let res: Response;
      try {
        res = await fetch(apiPath('api/perfumes/resolve'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...(identity ? { identity } : {}), ...(variantId ? { variantId } : {}) }) });
      } catch {
        throw new FriendlyError('Sem conexão com o computador. Confira se o `npm start` continua aberto.');
      }
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new FriendlyError(data?.error?.message ?? 'Não consegui analisar o link agora.');
      }
      let outcome: ImportOutcome | null = null;
      await readNdjson(res.body, (event: { stage?: ImportStage; outcome?: ImportOutcome }) => {
        if (event.stage) onStage(event.stage);
        if (event.outcome) outcome = event.outcome;
      });
      if (!outcome) throw new FriendlyError('A análise foi interrompida. Tente de novo.');
      return outcome;
    },
    async refresh(perfume, onStage, variantId) {
      let res: Response;
      try {
        res = await fetch(apiPath(`api/perfumes/${encodeURIComponent(perfume.id)}/refresh`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(variantId ? { variantId } : {}) });
      } catch {
        throw new FriendlyError('Sem conexão com o computador. Confira se o `npm start` continua aberto.');
      }
      if (!res.ok || !res.body) throw new FriendlyError('Não consegui pesquisar agora. Tente de novo.');
      let result: Perfume | null = null;
      let question: VariantQuestion | null = null;
      await readNdjson(res.body, (event: { stage?: ImportStage; perfume?: unknown; choose?: VariantQuestion & { identity?: { brand: string; name: string; concentration?: string | null }; source?: { label: string } | null } }) => {
        if (event.stage) onStage(event.stage);
        if (event.perfume) result = sanitizePerfume(event.perfume);
        if (event.choose) {
          const c = event.choose;
          question = { brand: c.identity?.brand ?? c.brand, name: c.identity?.name ?? c.name, concentration: c.identity?.concentration ?? c.concentration ?? null, variants: c.variants, preselectedId: c.preselectedId, sourceLabel: c.source?.label ?? c.sourceLabel ?? null };
        }
      });
      if (question) return { choose: question };
      if (!result) throw new FriendlyError('A pesquisa foi interrompida. Tente de novo.');
      return { perfume: result };
    },
    async uploadPhoto(file) {
      const res = await fetch(apiPath('api/photo'), { method: 'POST', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file }).catch(() => null);
      const data = res ? ((await res.json().catch(() => null)) as { media?: PhotoMedia; error?: { message?: string } } | null) : null;
      if (!res?.ok || !data?.media) throw new FriendlyError(data?.error?.message ?? 'Não consegui usar essa foto. Tente outra.');
      return data.media;
    },
  };
}

/* ---------------------------------------------------------------- claude.ai */

function artifactRepository(db: Db, assets: Assets | null, canWrite: boolean): Repository {
  const collection = db.collection('perfumes');
  const blobId = (ref: string | null) => (ref && /^\/_blob\/([\w-]+)$/.exec(ref)?.[1]) || null;
  return {
    mode: 'artifact',
    canReadLinks: false,
    canWrite,
    subscribe(onList, onError) {
      return collection.onSnapshot(
        (snap) => onList(clean(snap.docs.filter((d) => d.exists).map((d) => ({ ...d.data(), id: d.id })))),
        () => onError('A coleção ficou indisponível nesta página. Recarregue para tentar de novo.'),
      );
    },
    async save(perfume) {
      try {
        await collection.doc(perfume.id).set({ ...perfume });
      } catch (error) {
        const code = errorCode(error);
        throw new FriendlyError(code === 'quota_exceeded' ? 'A coleção chegou ao limite de itens desta página.' : 'Não consegui salvar agora. Tente de novo em instantes.');
      }
    },
    async remove(perfume) {
      await collection.doc(perfume.id).delete();
      for (const ref of [perfume.imageUrl, perfume.thumbUrl]) {
        const id = blobId(ref);
        if (id && assets) await assets.delete(id).catch(() => {});
      }
    },
    async importLink(url) {
      return guessOnly(url);
    },
    async uploadPhoto(file) {
      if (!assets) throw new FriendlyError('Enviar fotos não está disponível nesta visualização.');
      const photo = await processPhoto(file).catch(() => {
        throw new FriendlyError('Não consegui abrir essa imagem. Tente outra foto (JPG, PNG ou WebP).');
      });
      try {
        const [large, small] = await Promise.all([assets.upload(photo.large, { filename: 'frasco.webp' }), assets.upload(photo.small, { filename: 'frasco-mini.webp' })]);
        return { imageUrl: `/_blob/${large.id}`, thumbUrl: `/_blob/${small.id}`, dominantColor: photo.color.hex, cutout: photo.cutout };
      } catch {
        throw new FriendlyError('Não consegui guardar a foto agora. Tente de novo.');
      }
    },
  };
}

/* ---------------------------------------------------------------- navegador */

const LOCAL_KEY = 'perfume-collection.v1';

function localRepository(): Repository {
  let list: Perfume[] = [];
  const listeners = new Set<(l: Perfume[]) => void>();
  const emit = () => listeners.forEach((l) => l(list));
  const persist = () => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    } catch {
      throw new FriendlyError('O navegador não deixou guardar (espaço cheio ou modo privado).');
    }
  };
  const ready = (async () => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        list = clean(JSON.parse(raw) as unknown[]);
        return;
      }
    } catch {
      /* armazenamento indisponível ou corrompido: recomeça da planilha */
    }
    const seed = (await import('./seed.json')).default as unknown[];
    list = clean(seed);
  })();
  return {
    mode: 'local',
    canReadLinks: false,
    canWrite: true,
    subscribe(onList) {
      listeners.add(onList);
      void ready.then(() => onList(list));
      return () => listeners.delete(onList);
    },
    async save(perfume) {
      list = sortPerfumes([...list.filter((p) => p.id !== perfume.id), perfume]);
      persist();
      emit();
    },
    async remove(perfume) {
      list = list.filter((p) => p.id !== perfume.id);
      persist();
      emit();
    },
    async importLink(url) {
      return guessOnly(url);
    },
    async uploadPhoto(file) {
      const photo = await processPhoto(file).catch(() => {
        throw new FriendlyError('Não consegui abrir essa imagem. Tente outra foto (JPG, PNG ou WebP).');
      });
      const [imageUrl, thumbUrl] = await Promise.all([blobToDataUrl(photo.large), blobToDataUrl(photo.small)]);
      return { imageUrl, thumbUrl, dominantColor: photo.color.hex, cutout: photo.cutout };
    },
  };
}

/* ---------------------------------------------------------------- página pública (sem conta) */

/**
 * O que uma visita vê em /username[/lista]: as listas que o dono abriu, só leitura. O servidor já filtra pela
 * privacidade; aqui não há como escrever nada (a interface esconde ações quando canWrite é falso).
 */
function publicRepository(username: string, focus: 'wishlist' | 'collection' | null): Repository {
  let owner: PublicOwner | null = null;
  const readOnly = () => Promise.reject(new FriendlyError('Esta é uma página pública: só dá para ver.'));
  return {
    mode: 'public',
    canReadLinks: false,
    canWrite: false,
    owner: () => owner,
    subscribe(onList, onError) {
      let alive = true;
      // Sempre o perfil (com as listas que o dono abriu): o endereço só escolhe a aba — uma lista privada aparece
      // como "não é pública" dentro da mesma página, em vez de a página inteira falhar.
      fetch(apiPath(`api/public/${encodeURIComponent(username)}`), { cache: 'no-store' })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { user?: { username: string; displayName: string; bio: string | null }; lists?: PublicOwner['lists']; perfumes?: unknown[]; error?: { message?: string } } | null;
          if (!alive) return;
          if (!res.ok || !data?.user) {
            onError(data?.error?.message ?? 'Esta página não é pública.');
            return;
          }
          owner = { ...data.user, lists: data.lists ?? [], focus };
          onList(clean(data.perfumes ?? []));
        })
        .catch(() => alive && onError('Não consegui abrir esta página agora.'));
      return () => {
        alive = false;
      };
    },
    save: readOnly,
    remove: readOnly,
    importLink: readOnly,
    uploadPhoto: readOnly,
  };
}

/* ---------------------------------------------------------------- detecção */

export type Detected = { repo: Repository } | { pairing: true } | { offline: true };

async function status(timeoutMs: number): Promise<{ app?: string; authorized?: boolean } | null> {
  try {
    const res = await fetch(apiPath('api/status'), { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    return (await res.json()) as { app?: string; authorized?: boolean };
  } catch {
    return null;
  }
}

/** A página veio do servidor do app (ele marca o index.html)? Então o modo é sempre "servidor". */
export const servedByApp = () => typeof document !== 'undefined' && document.querySelector('meta[name="perfumes-server"]') !== null;

export async function detectRepository(): Promise<Detected> {
  if (claudeRuntime()) {
    const [db, assets, user] = await Promise.all([capability('db'), capability('assets'), capability('user')]);
    if (db) return { repo: artifactRepository(db, assets, user ? user.isOwner() : true) };
    return { repo: localRepository() };
  }
  // Página pública (/username, /username/wishlist, /username/collection): leitura sem conta, antes de qualquer código.
  const publicPath = servedByApp() ? parsePublicPath(window.location.pathname) : null;
  if (publicPath) return { repo: publicRepository(publicPath.username, publicPath.list) };
  if (servedByApp()) {
    // Quem serviu esta página foi o servidor: uma resposta lenta (processando uma foto) não é "sem servidor".
    // Tenta com paciência e, se não vier mesmo, avisa — nunca troca para o modo que não sabe abrir links.
    for (const wait of [8000, 12000, 20000]) {
      const s = await status(wait);
      if (s?.app === 'perfume-collection') return s.authorized ? { repo: serverRepository() } : { pairing: true };
    }
    return { offline: true };
  }
  const s = await status(2500);
  if (s?.app === 'perfume-collection') return s.authorized ? { repo: serverRepository() } : { pairing: true };
  // Sem servidor por perto (arquivo aberto direto, `npm run dev` sem API): coleção no navegador.
  return { repo: localRepository() };
}

export async function pair(code: string): Promise<void> {
  await api(apiPath('api/pair'), { method: 'POST', body: JSON.stringify({ code }) });
}
