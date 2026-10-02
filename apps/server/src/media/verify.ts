import { existsSync, readFileSync } from 'node:fs';
import type { Library } from '@perfumes/core/library';
import { isContentKey, sha256Hex, shaOfContentKey } from '../storage/keys';
import { StorageUnavailableError, type StoredEntry, type StoredObject } from '../storage/types';
import { isValidated, mapProblems, MediaMapError, validatedKeyFor, type MediaMap, type MediaMapData } from './map';
import { refLocations } from './migrate';
import { probePublic, SMOKE_CAUSE_TEXT, type PublicFetch } from './smoke';

/**
 * `npm run media:verify` — auditoria SOMENTE DE LEITURA da consistência entre o banco, o media-map.json, os arquivos
 * locais e os objetos do R2. Nunca grava: nem o mapa, nem o banco, nem o R2, nem relatório em disco (o tipo do R2 aqui
 * nem tem put/delete).
 *
 * Estados (não inventa um estado válido):
 *   pre-r2               não existe media-map.json e nenhuma referência do banco é chave por conteúdo: "R2 ainda não migrado".
 *   partial              o mapa existe, mas há referências locais do banco sem objeto validado (migração incompleta).
 *   complete-unverified  toda referência local tem objeto validado no mapa, mas os objetos NÃO foram conferidos no R2
 *                        (R2 não configurado ou inacessível): o mapa afirma, ninguém provou.
 *   verified             mapa completo E cada objeto do mapa foi baixado do R2 com o SHA-256 da chave (e, se pedido,
 *                        também pela URL pública).
 *   inconsistent         qualquer incoerência: mapa ilegível ou com registros contraditórios, arquivo local diferente do
 *                        mapa, SHA do banco diferente, objeto ausente/corrompido no R2, chave por conteúdo sem mapa…
 *
 * "Virada" (as referências do banco já serem `p/…`) é outra dimensão: é informada, não é erro — antes da FASE 3.2 o banco
 * ainda aponta para os arquivos locais e o estado correto é `verified` com 0 referências convertidas.
 */

export type VerifyState = 'pre-r2' | 'partial' | 'complete-unverified' | 'verified' | 'inconsistent';

export interface Finding {
  severity: 'error' | 'warn' | 'info';
  code: string;
  detail: string;
  count?: number;
  /** Até 10 exemplos (referências ou chaves — nunca segredos). */
  samples?: string[];
}

export interface VerifyReport {
  state: VerifyState;
  /** true só em pre-r2 (nada a verificar) e verified. */
  ok: boolean;
  headline: string;
  counts: { localRefs: number; contentRefs: number; mapObjects: number; mapRefs: number; pending: number; remoteObjectsChecked: number; publicObjectsChecked: number; deduplicatedRefs: number };
  findings: Finding[];
}

/** O R2 visto só para leitura: sem put/delete. */
export interface ReadOnlyRemote {
  readonly name: string;
  checkAccess(): Promise<void>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<StoredObject | null>;
  list(prefix?: string): Promise<StoredEntry[]>;
  publicUrl(key: string): string;
}

export interface VerifyInput {
  map: MediaMap;
  library: Library;
  /** SHA-256 que o banco registrou por referência (product_images.sha256), quando disponível. */
  expectedSha?: ReadonlyMap<string, string | null>;
  /** Arquivo local de uma referência antiga ("bottles/…", "media/…"), ou nulo. */
  resolveLocal: (ref: string) => string | null;
  remote?: ReadOnlyRemote | null;
  /** Se presente, cada objeto também é baixado pela URL pública e comparado. */
  fetchPublic?: PublicFetch | null;
  concurrency?: number;
  timeoutMs?: number;
}

const SAMPLES = 10;
const isLocalRef = (ref: string) => /^(bottles|media)\//.test(ref);

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
    }),
  );
}

function describeError(error: unknown): string {
  if (error instanceof StorageUnavailableError) return error.detail;
  return `erro inesperado (${(error as Error | undefined)?.name ?? 'Error'})`;
}

export async function verifyMedia(input: VerifyInput): Promise<VerifyReport> {
  const { library, map, remote } = input;
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], code: string, detail: string, list: readonly string[] = [], count = list.length) => {
    findings.push({ severity, code, detail, ...(count ? { count } : {}), ...(list.length ? { samples: list.slice(0, SAMPLES) } : {}) });
  };

  const refs = [...new Set(refLocations(library).map((l) => l.ref))];
  const localRefs = refs.filter(isLocalRef);
  const contentRefs = refs.filter(isContentKey);
  const counts: VerifyReport['counts'] = { localRefs: localRefs.length, contentRefs: contentRefs.length, mapObjects: 0, mapRefs: 0, pending: 0, remoteObjectsChecked: 0, publicObjectsChecked: 0, deduplicatedRefs: 0 };

  const finish = (state: VerifyState, headline: string): VerifyReport => ({ state, ok: state === 'pre-r2' || state === 'verified', headline, counts, findings });

  /** Acesso ao R2 (endereço + credenciais + bucket + permissão). false = não foi possível consultar. */
  const reach = async (severity: 'error' | 'warn'): Promise<boolean> => {
    if (!remote) return false;
    try {
      await remote.checkAccess();
      return true;
    } catch (error) {
      add(severity, 'remote_unreachable', `não foi possível consultar o R2: ${describeError(error)}`);
      return false;
    }
  };

  /* ---------------------------------------------------------------- A) sem mapa */
  if (!existsSync(input.map.file)) {
    if (contentRefs.length) add('error', 'content_refs_without_map', `${contentRefs.length} referência(s) do banco já são chaves por conteúdo (p/…), mas o media-map.json não existe`, contentRefs);
    if (await reach('warn')) {
      try {
        const objects = await remote!.list('p/');
        if (objects.length) add('error', 'remote_objects_without_map', `${objects.length} objeto(s) em p/ no R2, mas o media-map.json não existe (mapa perdido? restaure do backup)`, objects.map((o) => o.key));
      } catch (error) {
        add('warn', 'remote_unreachable', `não foi possível listar p/ no R2: ${describeError(error)}`);
      }
    }
    if (findings.some((f) => f.severity === 'error')) return finish('inconsistent', 'INCONSISTENTE: há sinais de migração (chaves por conteúdo no banco ou objetos no R2), mas o mapa não existe.');
    return finish('pre-r2', `R2 ainda não migrado: não existe media-map.json e nenhuma das ${refs.length} referência(s) do banco é chave por conteúdo.`);
  }

  /* ---------------------------------------------------------------- B/C) com mapa */
  let data: MediaMapData;
  try {
    data = map.read();
  } catch (error) {
    add('error', 'map_unreadable', error instanceof MediaMapError ? error.message : 'o media-map.json não pôde ser lido');
    return finish('inconsistent', 'INCONSISTENTE: o mapa existe mas não pôde ser lido — nada foi assumido. Restaure do backup.');
  }
  counts.mapObjects = Object.keys(data.objects).length;
  counts.mapRefs = Object.keys(data.refs).length;
  counts.deduplicatedRefs = Math.max(0, counts.mapRefs - counts.mapObjects);

  // 1. coerência interna do mapa (chave ↔ SHA ↔ referência; duplicatas)
  const byCode = new Map<string, { detail: string; list: string[] }>();
  for (const p of mapProblems(data)) {
    const entry = byCode.get(p.code) ?? { detail: p.detail, list: [] };
    entry.list.push(p.ref ?? p.key ?? '');
    byCode.set(p.code, entry);
  }
  for (const [code, { detail, list }] of byCode) add('error', code, `${detail} (${list.length})`, list);

  // 2. banco ↔ mapa
  const pending = localRefs.filter((ref) => !validatedKeyFor(data, ref));
  counts.pending = pending.length;
  if (pending.length) add('warn', 'pending_refs', `${pending.length} referência(s) locais do banco sem objeto validado no mapa`, pending);
  const unvalidated = contentRefs.filter((key) => !isValidated(data, key));
  if (unvalidated.length) add('error', 'content_ref_not_validated', `${unvalidated.length} referência(s) do banco são chaves por conteúdo sem entrada validada no mapa`, unvalidated);
  if (input.expectedSha) {
    const wrong: string[] = [];
    for (const [ref, sha] of input.expectedSha) {
      if (!sha) continue;
      const recorded = isContentKey(ref) ? shaOfContentKey(ref) : data.refs[ref]?.sha256;
      if (recorded && recorded !== sha) wrong.push(ref);
    }
    if (wrong.length) add('error', 'db_sha_mismatch', `${wrong.length} referência(s) em que o SHA-256 registrado no banco difere do mapa`, wrong);
  }
  const inUse = new Set<string>(contentRefs);
  for (const ref of localRefs) {
    const key = validatedKeyFor(data, ref);
    if (key) inUse.add(key);
  }
  const unused = Object.keys(data.objects).filter((key) => !inUse.has(key));
  if (unused.length) add('info', 'object_unreferenced', `${unused.length} objeto(s) do mapa que nenhuma referência do banco usa agora (normal se a foto saiu da coleção)`, unused);

  // 3. mapa ↔ arquivos locais (a cópia de origem é o caminho de volta)
  const missing: string[] = [];
  const diverging: string[] = [];
  for (const [ref, record] of Object.entries(data.refs)) {
    const file = input.resolveLocal(ref);
    if (!file || !existsSync(file)) {
      missing.push(ref);
      continue;
    }
    if (sha256Hex(readFileSync(file)) !== record.sha256) diverging.push(ref);
  }
  if (diverging.length) add('error', 'local_file_diverges', `${diverging.length} arquivo(s) local(is) com SHA-256 diferente do que o mapa provou no R2 (foto trocada depois da migração?)`, diverging);
  if (missing.length) add('warn', 'local_file_missing', `${missing.length} arquivo(s) local(is) de origem ausente(s): a volta (rollback) dessas fotos não seria possível`, missing);

  // 4. mapa ↔ R2 (e URL pública)
  let remoteComplete = false;
  if (remote && (await reach('error'))) {
    const keys = Object.keys(data.objects);
    const absent: string[] = [];
    const corrupt: string[] = [];
    const wrongSize: string[] = [];
    const failed: string[] = [];
    let firstFailure = '';
    await pool(keys, input.concurrency ?? 4, async (key) => {
      try {
        const object = await remote.get(key);
        counts.remoteObjectsChecked++;
        if (!object) absent.push(key);
        else if (sha256Hex(object.body) !== shaOfContentKey(key)) corrupt.push(key);
        else if (object.size !== data.objects[key]!.bytes) wrongSize.push(key);
      } catch (error) {
        failed.push(key);
        firstFailure ||= describeError(error);
      }
    });
    if (absent.length) add('error', 'remote_object_missing', `${absent.length} objeto(s) validados no mapa NÃO existem no R2`, absent.sort());
    if (corrupt.length) add('error', 'remote_sha_mismatch', `${corrupt.length} objeto(s) no R2 com SHA-256 diferente da chave`, corrupt.sort());
    if (wrongSize.length) add('error', 'remote_size_mismatch', `${wrongSize.length} objeto(s) no R2 com tamanho diferente do registrado no mapa`, wrongSize.sort());
    if (failed.length) add('error', 'remote_read_failed', `${failed.length} objeto(s) não puderam ser lidos do R2 (último erro: ${firstFailure})`, failed.sort());
    remoteComplete = failed.length === 0;

    try {
      const listed = await remote.list('p/');
      const unexpected = listed.filter((e) => !(e.key in data.objects)).map((e) => e.key);
      if (unexpected.length) add('warn', 'remote_unexpected_object', `${unexpected.length} objeto(s) em p/ no R2 que o mapa não conhece (nada foi apagado)`, unexpected.sort());
      const leftovers = await remote.list('healthcheck/');
      if (leftovers.length) add('warn', 'healthcheck_leftover', `${leftovers.length} objeto(s) de teste esquecidos em healthcheck/ (nada foi apagado)`, leftovers.map((e) => e.key));
    } catch (error) {
      add('error', 'remote_list_failed', `não foi possível listar o R2: ${describeError(error)}`);
      remoteComplete = false;
    }

    if (input.fetchPublic) {
      const byCause = new Map<string, string[]>();
      await pool(keys, input.concurrency ?? 4, async (key) => {
        const object = data.objects[key]!;
        const result = await probePublic(remote.publicUrl(key), { sha256: object.sha256, bytes: object.bytes }, input.fetchPublic!, input.timeoutMs ?? 15_000);
        counts.publicObjectsChecked++;
        if (!result.ok) byCause.set(result.cause!, [...(byCause.get(result.cause!) ?? []), key]);
      });
      for (const [cause, list] of byCause) add('error', cause, `${list.length} objeto(s) pela URL pública: ${SMOKE_CAUSE_TEXT[cause as keyof typeof SMOKE_CAUSE_TEXT]}`, list.sort());
    }
  }

  /* ---------------------------------------------------------------- estado */
  const integrity = findings.filter((f) => f.severity === 'error' && f.code !== 'remote_unreachable' && f.code !== 'remote_read_failed' && f.code !== 'remote_list_failed');
  const convert = `virada: ${counts.contentRefs} de ${counts.contentRefs + counts.localRefs} referências do banco já são chaves por conteúdo`;
  if (integrity.length) return finish('inconsistent', `INCONSISTENTE: ${integrity.length} tipo(s) de incoerência encontrados (veja abaixo). ${convert}.`);
  if (pending.length) return finish('partial', `Migração parcial: ${counts.localRefs - pending.length} de ${counts.localRefs} referências locais têm objeto validado; ${pending.length} pendentes. ${convert}.`);
  if (remote && remoteComplete && !findings.some((f) => f.severity === 'error')) {
    const pub = input.fetchPublic ? ` e ${counts.publicObjectsChecked} pela URL pública` : ' (URL pública NÃO verificada)';
    return finish('verified', `Mapa completo e ${counts.remoteObjectsChecked} objeto(s) verificados no R2 pelo SHA-256 lido de volta${pub}. ${convert}.`);
  }
  return finish('complete-unverified', `Mapa completo (${counts.mapObjects} objeto(s)), mas os objetos NÃO foram verificados no R2 ${remote ? '(o R2 não respondeu como devia)' : '(R2 não configurado)'}. ${convert}.`);
}

/* ------------------------------------------------------------------ saída */

const STATE_LABEL: Record<VerifyState, string> = {
  'pre-r2': 'PRÉ-R2 (nada a verificar)',
  partial: 'MIGRAÇÃO PARCIAL',
  'complete-unverified': 'MAPA COMPLETO, OBJETOS NÃO VERIFICADOS',
  verified: 'VERIFICADO',
  inconsistent: 'INCONSISTENTE',
};

export function formatVerifyReport(report: VerifyReport): string[] {
  const c = report.counts;
  const lines = [
    'media:verify — auditoria somente de leitura (nada é gravado)',
    `estado: ${STATE_LABEL[report.state]}`,
    report.headline,
    `referências do banco: ${c.localRefs} locais · ${c.contentRefs} por conteúdo · mapa: ${c.mapObjects} objeto(s), ${c.mapRefs} referência(s) (${c.deduplicatedRefs} deduplicada(s)) · pendentes: ${c.pending}`,
  ];
  const tag = { error: 'ERRO ', warn: 'AVISO', info: 'INFO ' } as const;
  for (const f of report.findings) {
    lines.push(`  ${tag[f.severity]} ${f.code}: ${f.detail}`);
    for (const s of f.samples ?? []) lines.push(`          - ${s}`);
    if ((f.count ?? 0) > (f.samples?.length ?? 0)) lines.push(`          … e mais ${(f.count ?? 0) - (f.samples?.length ?? 0)}`);
  }
  lines.push(report.ok ? (report.state === 'pre-r2' ? 'RESULTADO: OK — R2 ainda não migrado; nada a verificar' : 'RESULTADO: OK — verificado') : report.state === 'complete-unverified' ? 'RESULTADO: NÃO VERIFICADO' : report.state === 'partial' ? 'RESULTADO: INCOMPLETO' : 'RESULTADO: FALHOU');
  return lines;
}
