import { existsSync, readFileSync } from 'node:fs';
import type { Library } from '@perfumes/core/library';
import { contentAddress, isContentKey, sha256Hex, shaOfContentKey } from '../storage/keys';
import { ChecksumMismatchError, StorageUnavailableError, type StorageProvider } from '../storage/types';
import { isValidated, originalsFor, validatedKeyFor, type MediaMap, type MediaMapData, type RefChange, type RefField, type RefLocation } from './map';

/**
 * Migração das fotos para o R2 (FASE 3), em três partes que NUNCA se misturam:
 *
 *   1. inventário + dry-run: lê os arquivos locais, calcula SHA-256 e chaves, consulta o destino só para LER
 *      (exists). Não sobe nada — o tipo nem permite (`RemoteReader`).
 *   2. upload com prova (`migrateObjects`): sobe cada conteúdo UMA vez, baixa de volta, recalcula o SHA-256 e só então
 *      grava "validated" no mapa. Não toca em nenhuma referência do banco.
 *   3. virada / volta das referências (`planCutover`, `planRollback`, `applyRefChanges`): funções puras sobre a
 *      biblioteca, tudo-ou-nada — se UMA referência não tem objeto validado (ou arquivo local conferido, na volta),
 *      o plano não muda nada. Aplicar no banco é da FASE 3.2, com backup antes; aqui só existe e é testado.
 */

export const IMMUTABLE = 'public, max-age=31536000, immutable';

/* ------------------------------------------------------------------ onde estão as referências */

const IMAGE_FIELDS = ['url', 'thumbUrl', 'masterUrl'] as const;

export type Located = RefLocation & { ref: string };

/** Cada lugar da biblioteca que guarda uma referência de imagem (fotos dos produtos e avatares). */
export function refLocations(library: Library): Located[] {
  const out: Located[] = [];
  for (const p of library.products)
    p.images.forEach((img, imageIndex) => {
      for (const field of IMAGE_FIELDS) {
        const ref = img[field];
        if (ref) out.push({ productId: p.id, imageIndex, userId: null, field, ref });
      }
    });
  for (const u of library.users) if (u.avatarUrl) out.push({ productId: null, imageIndex: null, userId: u.id, field: 'avatarUrl', ref: u.avatarUrl });
  return out;
}

const locationId = (l: RefLocation) => `${l.productId ?? ''}|${l.imageIndex ?? ''}|${l.userId ?? ''}|${l.field}`;
const isLocalRef = (ref: string) => /^(bottles|media)\//.test(ref);

/* ------------------------------------------------------------------ inventário */

export interface InventoryItem {
  ref: string;
  kind: 'local' | 'content' | 'external';
  file: string | null;
  sha256: string | null;
  bytes: number | null;
  key: string | null;
  contentType: string | null;
  problem: string | null;
}

/**
 * Cada referência distinta, com arquivo, SHA-256 e a chave que teria. `expected` (SHA-256 registrado no banco ou no
 * baseline) acusa arquivo trocado. Referência externa (http, data:, /_blob) não é nossa: fica como está.
 */
export function inventory(refs: Iterable<string>, resolve: (ref: string) => string | null, expected: ReadonlyMap<string, string | null> = new Map()): InventoryItem[] {
  return [...new Set(refs)].sort().map((ref): InventoryItem => {
    const base = { ref, file: null, sha256: null, bytes: null, key: null, contentType: null, problem: null };
    if (isContentKey(ref)) return { ...base, kind: 'content', key: ref, sha256: shaOfContentKey(ref), file: resolve(ref) };
    if (!isLocalRef(ref)) return { ...base, kind: 'external' };
    const file = resolve(ref);
    if (!file || !existsSync(file)) return { ...base, kind: 'local', file, problem: 'arquivo ausente' };
    const body = readFileSync(file);
    try {
      const address = contentAddress(body);
      const want = expected.get(ref);
      const problem = want && want !== address.sha256 ? `divergente: SHA-256 do arquivo ≠ registrado (${want.slice(0, 12)}…)` : null;
      return { ...base, kind: 'local', file, sha256: address.sha256, bytes: address.bytes, key: address.key, contentType: address.contentType, problem };
    } catch (error) {
      return { ...base, kind: 'local', file, problem: (error as Error).message };
    }
  });
}

/* ------------------------------------------------------------------ dry-run */

/** O destino visto só para leitura. Sem put/delete: o dry-run não tem como gravar. */
export interface RemoteReader {
  readonly name: string;
  exists(key: string): Promise<boolean>;
}

export type DryRunState =
  | 'enviar'
  | 'duplicado (mesmo conteúdo de outra referência)'
  | 'já validado no mapa'
  | 'já existe no destino, sem prova no mapa'
  | 'já por conteúdo'
  | 'arquivo ausente'
  | 'divergente'
  | 'inválido'
  | 'externa';

export interface DryRunReport {
  dryRun: true;
  total: number;
  localRefs: number;
  uniqueObjects: number;
  keysToCreate: string[];
  alreadyValidated: string[];
  existingRemote: string[];
  duplicatesAvoided: number;
  refsToChange: { ref: string; key: string }[];
  missing: string[];
  divergences: { ref: string; detail: string }[];
  remoteChecked: boolean;
  remoteErrors: string[];
  files: { ref: string; sha256: string | null; key: string | null; bytes: number | null; state: DryRunState }[];
}

export async function dryRun(items: readonly InventoryItem[], map: MediaMapData, remote: RemoteReader | null): Promise<DryRunReport> {
  const report: DryRunReport = {
    dryRun: true,
    total: items.length,
    localRefs: items.filter((i) => i.kind === 'local').length,
    uniqueObjects: 0,
    keysToCreate: [],
    alreadyValidated: [],
    existingRemote: [],
    duplicatesAvoided: 0,
    refsToChange: [],
    missing: [],
    divergences: [],
    remoteChecked: Boolean(remote),
    remoteErrors: [],
    files: [],
  };
  const seen = new Set<string>();
  const remoteState = new Map<string, boolean | null>();
  for (const item of items) {
    const row = { ref: item.ref, sha256: item.sha256, key: item.key, bytes: item.bytes };
    if (item.kind === 'external') {
      report.files.push({ ...row, state: 'externa' });
      continue;
    }
    if (item.kind === 'content') {
      report.files.push({ ...row, state: 'já por conteúdo' });
      continue;
    }
    if (item.problem === 'arquivo ausente') {
      report.missing.push(item.ref);
      report.files.push({ ...row, state: 'arquivo ausente' });
      continue;
    }
    // Arquivo que mudou depois de migrado: o mapa guarda outro SHA-256 para a mesma referência.
    const recorded = map.refs[item.ref];
    const detail = item.problem ?? (recorded && item.sha256 && recorded.sha256 !== item.sha256 ? `divergente: o mapa registrou ${recorded.sha256.slice(0, 12)}…, o arquivo agora é ${item.sha256.slice(0, 12)}…` : null);
    if (detail || !item.key) {
      if (detail?.startsWith('divergente')) report.divergences.push({ ref: item.ref, detail });
      report.files.push({ ...row, state: detail?.startsWith('divergente') ? 'divergente' : 'inválido' });
      continue;
    }
    report.refsToChange.push({ ref: item.ref, key: item.key });
    if (seen.has(item.key)) {
      report.duplicatesAvoided++;
      report.files.push({ ...row, state: 'duplicado (mesmo conteúdo de outra referência)' });
      continue;
    }
    seen.add(item.key);
    if (isValidated(map, item.key)) {
      report.alreadyValidated.push(item.key);
      report.files.push({ ...row, state: 'já validado no mapa' });
      continue;
    }
    let exists: boolean | null = null;
    if (remote) {
      try {
        exists = await remote.exists(item.key);
      } catch (error) {
        report.remoteErrors.push(`${item.key}: ${(error as Error).message}`);
      }
    }
    remoteState.set(item.key, exists);
    if (exists) report.existingRemote.push(item.key);
    else report.keysToCreate.push(item.key);
    report.files.push({ ...row, state: exists ? 'já existe no destino, sem prova no mapa' : 'enviar' });
  }
  report.uniqueObjects = seen.size;
  return report;
}

/* ------------------------------------------------------------------ upload com prova */

export interface MigrationFailure {
  key: string;
  refs: string[];
  reason: string;
}

export interface MigrationReport {
  ok: boolean;
  uploaded: string[];
  skipped: string[];
  failed: MigrationFailure[];
}

/** Um upload por chave neste processo: pedidos simultâneos do mesmo conteúdo esperam o mesmo resultado. */
const inflight = new Map<string, Promise<'uploaded' | 'skipped'>>();

function describe(error: unknown): string {
  if (error instanceof ChecksumMismatchError) return `SHA-256 divergente — não validado (${error.message})`;
  if (error instanceof StorageUnavailableError) return `destino indisponível — não validado (${error.message})`;
  return `não validado: ${(error as Error)?.message ?? String(error)}`;
}

interface MigrateOptions {
  remote: StorageProvider;
  map: MediaMap;
  /** Uploads ao mesmo tempo (padrão 4). */
  concurrency?: number;
}

/**
 * Sobe os objetos e prova cada um: put com SHA-256 → get → SHA-256 do que voltou == SHA-256 original == o da chave.
 * Só então o objeto vira "validated" no mapa (e as referências antigas apontam para ele). Qualquer falha deixa o
 * objeto FORA do mapa como validado e segue para o próximo; nenhuma referência do banco é tocada aqui.
 */
export async function migrateObjects(items: readonly InventoryItem[], options: MigrateOptions): Promise<MigrationReport> {
  const { remote, map } = options;
  const groups = new Map<string, InventoryItem[]>();
  for (const item of items) {
    if (item.kind !== 'local' || item.problem || !item.key || !item.file || !item.sha256) continue;
    groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  }
  const report: MigrationReport = { ok: true, uploaded: [], skipped: [], failed: [] };
  const queue = [...groups.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, group] = next;
      try {
        const id = `${remote.name}:${key}`;
        let run = inflight.get(id);
        if (!run) {
          run = migrateOne(key, group, remote, map).finally(() => inflight.delete(id));
          inflight.set(id, run);
        }
        const result = await run;
        // Quem esperou o upload de outro também registra as SUAS referências (mesmo conteúdo, outro nome).
        await recordRefs(map, key, group);
        (result === 'uploaded' ? report.uploaded : report.skipped).push(key);
      } catch (error) {
        report.failed.push({ key, refs: group.map((g) => g.ref), reason: describe(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, groups.size)) }, worker));
  report.ok = report.failed.length === 0;
  report.uploaded.sort();
  report.skipped.sort();
  return report;
}

async function migrateOne(key: string, group: InventoryItem[], remote: StorageProvider, map: MediaMap): Promise<'uploaded' | 'skipped'> {
  const first = group[0]!;
  // Já provado antes e ainda lá: não sobe de novo.
  if (map.isValidated(key) && (await remote.exists(key))) return 'skipped';
  const body = readFileSync(first.file!);
  const sha = sha256Hex(body);
  // O arquivo mudou entre o inventário e agora? Então não é o conteúdo que a chave promete.
  if (sha !== first.sha256 || sha !== shaOfContentKey(key)) throw new ChecksumMismatchError(key, first.sha256!, sha);
  await remote.put(key, body, { contentType: first.contentType!, cacheControl: IMMUTABLE, sha256: sha });
  // HTTP 200 no upload não é prova: baixa de volta e confere byte a byte (pelo SHA-256).
  const back = await remote.get(key);
  if (!back) throw new Error('objeto ausente logo depois do upload');
  const backSha = sha256Hex(back.body);
  if (backSha !== sha) {
    // Objeto com conteúdo errado sob uma chave por conteúdo não pode ficar: tenta tirar (sem garantia; não é validado).
    await remote.delete(key).catch(() => false);
    throw new ChecksumMismatchError(key, sha, backSha);
  }
  const now = new Date().toISOString();
  await map.update((data) => {
    data.objects[key] = { sha256: sha, bytes: body.length, contentType: first.contentType!, status: 'validated', validatedAt: now, storage: remote.name };
    for (const item of group) data.refs[item.ref] = { key, sha256: sha, recordedAt: now };
  });
  return 'uploaded';
}

async function recordRefs(map: MediaMap, key: string, group: InventoryItem[]) {
  const data = map.read();
  const missing = group.filter((g) => data.refs[g.ref]?.key !== key);
  if (!missing.length) return;
  const now = new Date().toISOString();
  await map.update((d) => {
    if (d.objects[key]?.status !== 'validated') throw new Error(`objeto ${key} não está validado: referências não registradas`);
    for (const item of missing) d.refs[item.ref] = { key, sha256: d.objects[key]!.sha256, recordedAt: now };
  });
}

/* ------------------------------------------------------------------ virada e volta (puras, tudo-ou-nada) */

export interface RefPlan {
  ok: boolean;
  changes: RefChange[];
  blocked: { location: RefLocation; ref: string; reason: string }[];
}

const locationOf = (l: Located): RefLocation => ({ productId: l.productId, imageIndex: l.imageIndex, userId: l.userId, field: l.field });

/** Virada: cada referência local vira a chave validada no R2. Uma sem prova bloqueia o plano inteiro. */
export function planCutover(library: Library, map: MediaMapData): RefPlan {
  const changes: RefChange[] = [];
  const blocked: RefPlan['blocked'] = [];
  for (const l of refLocations(library)) {
    if (!isLocalRef(l.ref)) continue; // já por conteúdo, ou externa
    const key = validatedKeyFor(map, l.ref);
    if (key) changes.push({ ...locationOf(l), from: l.ref, to: key });
    else blocked.push({ location: locationOf(l), ref: l.ref, reason: 'sem objeto validado no R2' });
  }
  return { ok: blocked.length === 0, changes: blocked.length ? [] : changes, blocked };
}

/**
 * Volta: cada chave por conteúdo vira a referência local de antes. Primeiro pelo DIÁRIO da virada (o lugar exato);
 * sem diário, pelo mapa só quando há UMA referência antiga com aquele conteúdo (ambíguo = bloqueia, nunca adivinha).
 * Exige o arquivo local com o SHA-256 da chave — voltar para um arquivo que não existe não é voltar.
 */
export function planRollback(library: Library, map: MediaMapData, resolve: (ref: string) => string | null): RefPlan {
  const journal = new Map<string, RefChange>();
  for (const entry of map.journal)
    for (const c of entry.changes) {
      if (entry.kind === 'cutover') journal.set(locationId(c), c);
      else journal.delete(locationId(c));
    }
  const changes: RefChange[] = [];
  const blocked: RefPlan['blocked'] = [];
  for (const l of refLocations(library)) {
    if (!isContentKey(l.ref)) continue;
    const logged = journal.get(locationId(l));
    const originals = originalsFor(map, l.ref);
    const target = logged && logged.to === l.ref ? logged.from : originals.length === 1 ? originals[0]! : null;
    if (!target) {
      blocked.push({ location: locationOf(l), ref: l.ref, reason: originals.length ? `ambíguo: ${originals.length} referências antigas com este conteúdo e nenhum registro da virada` : 'sem referência antiga no mapa' });
      continue;
    }
    const file = resolve(target);
    if (!file || !existsSync(file) || sha256Hex(readFileSync(file)) !== shaOfContentKey(l.ref)) {
      blocked.push({ location: locationOf(l), ref: l.ref, reason: `arquivo local de ${target} ausente ou diferente` });
      continue;
    }
    changes.push({ ...locationOf(l), from: l.ref, to: target });
  }
  return { ok: blocked.length === 0, changes: blocked.length ? [] : changes, blocked };
}

/** Aplica um plano numa CÓPIA da biblioteca. Cada troca confere o valor de antes: plano velho não sobrescreve nada. */
export function applyRefChanges(library: Library, changes: readonly RefChange[]): Library {
  const next = structuredClone(library);
  for (const c of changes) {
    if (c.field === 'avatarUrl') {
      const user = next.users.find((u) => u.id === c.userId);
      if (!user || user.avatarUrl !== c.from) throw new Error(`referência mudou desde o plano (${c.userId}/${c.field})`);
      user.avatarUrl = c.to;
      continue;
    }
    const img = next.products.find((p) => p.id === c.productId)?.images[c.imageIndex ?? -1];
    const field = c.field as Exclude<RefField, 'avatarUrl'>;
    if (!img || img[field] !== c.from) throw new Error(`referência mudou desde o plano (${c.productId}/${c.imageIndex}/${c.field})`);
    img[field] = c.to;
  }
  return next;
}
