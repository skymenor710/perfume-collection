import { randomBytes } from 'node:crypto';
import { formatR2Diagnosis, type R2Diagnosis, type R2Settings } from '../config';
import { classifyNetworkError, FAILURE_TEXT, type StorageFailure } from '../storage/failure';
import { sha256Hex } from '../storage/keys';
import { ChecksumMismatchError, StorageUnavailableError, type PutOptions, type RemoteStorage, type StoredEntry, type StoredObject } from '../storage/types';

/**
 * `npm run media:smoke` — teste de ponta a ponta do R2 com UM objeto descartável, antes de qualquer foto real.
 *
 * Sequência (cada etapa diz PASS ou FAIL com a CAUSA; a primeira falha interrompe o resto e a limpeza sempre roda):
 *   1 acesso      listagem mínima sob healthcheck/ — prova endereço, credenciais, bucket e permissão
 *   2 put         "healthcheck/<data-hora>-<aleatório>/probe.txt", com o SHA-256 conferido também pelo servidor
 *   3 exists      HEAD encontra o objeto
 *   4 get         baixa de volta: tamanho e SHA-256 iguais
 *   5 list        listagem DO PRÓPRIO PREFIXO mostra exatamente esse objeto
 *   6 absent      uma chave que nunca foi enviada volta "não existe" (o 404 é tratado como ausência, não como erro)
 *   7 public      baixa pela URL PÚBLICA (R2_PUBLIC_BASE_URL) e compara o SHA-256 — não basta HTTP 200
 *   8 delete      apaga SÓ o objeto de teste
 *   9 gone        HEAD diz que não existe mais e a listagem do prefixo está vazia
 *
 * Travas: todo acesso passa por `scopedRemote` — só chaves "healthcheck/<id>/<nome>.txt" do próprio teste, só o
 * `probe.txt` pode ser apagado, nunca uma chave `p/…`, nunca o bucket, nunca uma listagem global. Nenhuma saída traz
 * chave de acesso, segredo ou o endereço S3 (o CLI ainda passa tudo por `makeRedactor`).
 *
 * O módulo não lê configuração nem ambiente: recebe o armazenamento e o `fetch` público. Os testes usam falsos.
 */

export const SMOKE_ROOT = 'healthcheck/';
const PREFIX_RE = /^healthcheck\/\d{8}T\d{6}Z-[0-9a-f]{1,16}\/$/;

export class SmokeScopeError extends Error {}

/** O armazenamento visto pelo smoke: só o prefixo do próprio teste. */
export interface SmokeRemote {
  readonly prefix: string;
  checkAccess(): Promise<void>;
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<StoredObject | null>;
  /** Sempre o prefixo do teste. */
  list(): Promise<StoredEntry[]>;
  /** Só o `probe.txt` do próprio teste. */
  delete(key: string): Promise<boolean>;
  publicUrl(key: string): string;
}

export function scopedRemote(remote: RemoteStorage, prefix: string): SmokeRemote {
  if (!PREFIX_RE.test(prefix)) throw new SmokeScopeError('prefixo de teste inválido');
  const inScope = (key: string) => {
    if (!key.startsWith(prefix) || !/^[a-z]+\.txt$/.test(key.slice(prefix.length))) throw new SmokeScopeError('chave fora do prefixo do teste');
    return key;
  };
  return {
    prefix,
    // Tudo assíncrono: violar a trava SEMPRE rejeita a promessa (nunca lança de forma síncrona, nunca chega ao R2).
    checkAccess: async () => remote.checkAccess(),
    put: async (key, body, options) => remote.put(inScope(key), body, options),
    exists: async (key) => remote.exists(inScope(key)),
    get: async (key) => remote.get(inScope(key)),
    list: async () => remote.list(prefix),
    delete: async (key) => {
      if (inScope(key) !== `${prefix}probe.txt`) throw new SmokeScopeError('o teste só apaga o objeto que ele mesmo criou');
      return remote.delete(key);
    },
    publicUrl: (key) => remote.publicUrl(inScope(key)),
  };
}

/* ------------------------------------------------------------------ causas */

export type PublicCause = 'public_dns' | 'public_connection' | 'public_tls' | 'public_timeout' | 'public_network' | 'public_not_found' | 'public_forbidden' | 'public_redirect' | 'public_server' | 'public_status' | 'public_wrong_content';

export type SmokeCause = StorageFailure | PublicCause | 'object_missing' | 'content_mismatch' | 'list_mismatch' | 'delete_failed' | 'still_exists';

export const SMOKE_CAUSE_TEXT: Record<SmokeCause, string> = {
  ...FAILURE_TEXT,
  object_missing: 'o S3 aceitou o envio, mas o objeto não aparece na leitura',
  content_mismatch: 'o conteúdo lido de volta não é o que foi enviado',
  list_mismatch: 'a listagem do prefixo não mostra exatamente o objeto de teste',
  delete_failed: 'o S3 não confirmou a remoção do objeto de teste',
  still_exists: 'o objeto de teste continua existindo depois de apagado',
  public_dns: 'domínio público: o nome não foi encontrado (DNS) — R2_PUBLIC_BASE_URL digitado errado ou domínio ainda não propagado?',
  public_connection: 'domínio público: conexão recusada ou interrompida',
  public_tls: 'domínio público: falha de certificado/TLS',
  public_timeout: 'domínio público: sem resposta no tempo limite',
  public_network: 'domínio público: falha de rede',
  public_not_found: 'domínio público respondeu 404 — o S3 confirmou que o objeto existe, então o acesso público do bucket está desligado ou o domínio aponta para outro bucket',
  public_forbidden: 'domínio público respondeu 401/403: o acesso público do bucket está desligado ou bloqueado',
  public_redirect: 'domínio público respondeu com redirecionamento (deve servir o arquivo direto)',
  public_server: 'domínio público respondeu erro 5xx',
  public_status: 'domínio público respondeu um status inesperado',
  public_wrong_content: 'o domínio público devolveu conteúdo diferente do enviado (página de erro, cache antigo ou outro bucket)',
};

export type CauseGroup = 'autenticação' | 'S3' | 'bucket' | 'objeto' | 'domínio público' | 'timeout' | 'conteúdo' | 'limpeza';

/** Em qual das famílias pedidas a falha cai (autenticação, S3, bucket inexistente, objeto inexistente, domínio público, timeout, conteúdo). */
export function causeGroup(cause: SmokeCause): CauseGroup {
  switch (cause) {
    case 'invalid_credentials':
    case 'signature':
    case 'clock_skew':
    case 'access_denied':
    case 'forbidden':
      return 'autenticação';
    case 'no_such_bucket':
      return 'bucket';
    case 'object_missing':
      return 'objeto';
    case 'timeout':
    case 'public_timeout':
      return 'timeout';
    case 'content_mismatch':
    case 'list_mismatch':
    case 'public_wrong_content':
      return 'conteúdo';
    case 'delete_failed':
    case 'still_exists':
      return 'limpeza';
    case 'public_dns':
    case 'public_connection':
    case 'public_tls':
    case 'public_network':
    case 'public_not_found':
    case 'public_forbidden':
    case 'public_redirect':
    case 'public_server':
    case 'public_status':
      return 'domínio público';
    default:
      return 'S3';
  }
}

/* ------------------------------------------------------------------ prova pela URL pública (também usada por media:verify) */

export type PublicFetch = (url: string, init: { signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

export interface PublicResult {
  ok: boolean;
  cause?: PublicCause;
  /** Sem URL, sem cabeçalhos: só o status ou o tipo de falha. */
  detail: string;
}

/**
 * Baixa pela URL pública e compara tamanho e SHA-256 com o esperado. HTTP 200 sozinho não basta: uma página de erro, um
 * cache antigo ou outro bucket também respondem 200.
 */
export async function probePublic(url: string, expected: { sha256: string; bytes: number }, fetchPublic: PublicFetch, timeoutMs = 15_000): Promise<PublicResult> {
  let res: Response;
  try {
    res = await fetchPublic(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (error) {
    const failure = classifyNetworkError(error);
    const cause: PublicCause = failure === 'dns' ? 'public_dns' : failure === 'connection' ? 'public_connection' : failure === 'tls' ? 'public_tls' : failure === 'timeout' ? 'public_timeout' : 'public_network';
    return { ok: false, cause, detail: SMOKE_CAUSE_TEXT[cause] };
  }
  const status = res.status;
  if (status !== 200) {
    await res.body?.cancel().catch(() => {});
    const cause: PublicCause = status >= 300 && status < 400 ? 'public_redirect' : status === 404 || status === 410 ? 'public_not_found' : status === 401 || status === 403 ? 'public_forbidden' : status >= 500 ? 'public_server' : 'public_status';
    return { ok: false, cause, detail: `HTTP ${status}: ${SMOKE_CAUSE_TEXT[cause]}` };
  }
  let body: Buffer;
  try {
    body = Buffer.from(await res.arrayBuffer());
  } catch {
    return { ok: false, cause: 'public_network', detail: 'corpo interrompido: ' + SMOKE_CAUSE_TEXT.public_network };
  }
  if (body.length !== expected.bytes || sha256Hex(body) !== expected.sha256) return { ok: false, cause: 'public_wrong_content', detail: `HTTP 200, mas ${SMOKE_CAUSE_TEXT.public_wrong_content}` };
  return { ok: true, detail: `HTTP 200 e SHA-256 idêntico ao enviado (${body.length} bytes)` };
}

/* ------------------------------------------------------------------ o smoke */

export interface SmokeStep {
  id: 'access' | 'put' | 'exists' | 'get' | 'list' | 'absent' | 'public' | 'delete' | 'gone';
  title: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  cause?: SmokeCause;
}

export interface SmokeReport {
  ok: boolean;
  prefix: string;
  steps: SmokeStep[];
  /** deleted: apagado no fim (ou já na etapa 8); not_needed: nada foi criado/ficou; failed: pode ter ficado lixo. */
  cleanup: 'deleted' | 'not_needed' | 'failed';
  failure?: { step: SmokeStep['id']; cause: SmokeCause; group: CauseGroup; text: string };
}

export interface SmokeDeps {
  remote: RemoteStorage;
  fetchPublic: PublicFetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Sufixo aleatório do identificador (hexadecimal). Injetável nos testes. */
  randomId?: () => string;
}

class SmokeFailure extends Error {
  constructor(
    readonly cause: SmokeCause,
    readonly detail: string,
  ) {
    super(detail);
  }
}

function explain(error: unknown): { cause: SmokeCause; detail: string } {
  if (error instanceof SmokeFailure) return { cause: error.cause, detail: error.detail };
  if (error instanceof StorageUnavailableError) return { cause: error.code, detail: error.detail };
  if (error instanceof ChecksumMismatchError) return { cause: 'content_mismatch', detail: 'o servidor recusou o conteúdo pelo checksum (SHA-256)' };
  if (error instanceof SmokeScopeError) return { cause: 'unexpected', detail: `trava do smoke: ${error.message}` };
  return { cause: 'unexpected', detail: `erro inesperado (${(error as Error | undefined)?.name ?? 'Error'})` };
}

export async function runSmoke(deps: SmokeDeps): Promise<SmokeReport> {
  const now = (deps.now ?? (() => new Date()))();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const id = `${stamp}-${(deps.randomId ?? (() => randomBytes(4).toString('hex')))()}`;
  const prefix = `${SMOKE_ROOT}${id}/`;
  const remote = scopedRemote(deps.remote, prefix);
  const probeKey = `${prefix}probe.txt`;
  const absentKey = `${prefix}absent.txt`;
  const body = Buffer.from(`meus-perfumes media:smoke\nid: ${id}\nnonce: ${randomBytes(8).toString('hex')}\n`);
  const sha = sha256Hex(body);
  const timeoutMs = deps.timeoutMs ?? 15_000;

  const steps: SmokeStep[] = [];
  const state: { failed: SmokeStep | null; attempted: boolean; deleted: boolean } = { failed: null, attempted: false, deleted: false };

  const run = async (stepId: SmokeStep['id'], title: string, fn: () => Promise<string>) => {
    if (state.failed) {
      steps.push({ id: stepId, title, status: 'skip', detail: 'não executada (etapa anterior falhou)' });
      return;
    }
    try {
      steps.push({ id: stepId, title, status: 'pass', detail: await fn() });
    } catch (error) {
      const { cause, detail } = explain(error);
      state.failed = { id: stepId, title, status: 'fail', detail, cause };
      steps.push(state.failed);
    }
  };

  await run('access', 'acesso ao bucket', async () => {
    await remote.checkAccess();
    return 'endereço, credenciais e bucket aceitos (listagem mínima sob healthcheck/)';
  });
  await run('put', 'envio do objeto de teste', async () => {
    state.attempted = true; // mesmo que o envio falhe no meio, a limpeza confere
    await remote.put(probeKey, body, { contentType: 'text/plain', cacheControl: 'no-store', sha256: sha });
    return `enviado (${body.length} bytes) com o SHA-256 conferido também pelo servidor`;
  });
  await run('exists', 'objeto existe (HEAD)', async () => {
    if (!(await remote.exists(probeKey))) throw new SmokeFailure('object_missing', 'o HEAD não encontrou o objeto recém-enviado');
    return 'encontrado';
  });
  await run('get', 'leitura de volta e SHA-256', async () => {
    const object = await remote.get(probeKey);
    if (!object) throw new SmokeFailure('object_missing', 'o GET não encontrou o objeto recém-enviado');
    if (object.size !== body.length || sha256Hex(object.body) !== sha) throw new SmokeFailure('content_mismatch', 'tamanho ou SHA-256 diferentes do enviado');
    return `${object.size} bytes, SHA-256 idêntico ao enviado`;
  });
  await run('list', 'listagem do prefixo do teste', async () => {
    const entries = await remote.list();
    if (entries.length !== 1 || entries[0]!.key !== probeKey || entries[0]!.size !== body.length) throw new SmokeFailure('list_mismatch', `esperado 1 objeto, a listagem trouxe ${entries.length}`);
    return 'exatamente 1 objeto';
  });
  await run('absent', 'chave nunca enviada devolve "não existe"', async () => {
    if ((await remote.get(absentKey)) !== null) throw new SmokeFailure('content_mismatch', 'uma chave que nunca foi enviada devolveu conteúdo');
    if (await remote.exists(absentKey)) throw new SmokeFailure('content_mismatch', 'uma chave que nunca foi enviada diz que existe');
    return 'ausência tratada como ausência (não como erro)';
  });
  await run('public', 'leitura pela URL pública', async () => {
    const result = await probePublic(remote.publicUrl(probeKey), { sha256: sha, bytes: body.length }, deps.fetchPublic, timeoutMs);
    if (!result.ok) throw new SmokeFailure(result.cause!, result.detail);
    return result.detail;
  });
  await run('delete', 'remoção do objeto de teste', async () => {
    if (!(await remote.delete(probeKey))) throw new SmokeFailure('delete_failed', 'o S3 disse que o objeto não existia na hora de apagar');
    state.deleted = true;
    return 'apagado (somente o objeto de teste)';
  });
  await run('gone', 'objeto realmente sumiu', async () => {
    if (await remote.exists(probeKey)) throw new SmokeFailure('still_exists', 'o HEAD ainda encontra o objeto');
    const left = await remote.list();
    if (left.length) throw new SmokeFailure('still_exists', `a listagem do prefixo ainda mostra ${left.length} objeto(s)`);
    return 'HEAD diz que não existe e a listagem do prefixo está vazia';
  });

  // Limpeza: se o teste criou (ou tentou criar) o objeto e ele não foi apagado na etapa 8, tenta agora — só o probe.txt.
  let cleanup: SmokeReport['cleanup'] = state.deleted ? 'deleted' : 'not_needed';
  if (state.attempted && !state.deleted) {
    try {
      cleanup = (await remote.delete(probeKey)) ? 'deleted' : 'not_needed';
    } catch {
      cleanup = 'failed';
    }
  }
  const step = state.failed;
  const ok = !step && cleanup !== 'failed';
  const failure = step ? { step: step.id, cause: step.cause!, group: causeGroup(step.cause!), text: SMOKE_CAUSE_TEXT[step.cause!] } : undefined;
  return { ok, prefix, steps, cleanup, failure };
}

/* ------------------------------------------------------------------ pré-condições e saída */

/** O smoke só roda com o R2 completo e válido. Sem isso: recusa, com o diagnóstico, sem tocar em nada. */
export function planSmoke(diagnosis: R2Diagnosis): { run: true } | { run: false; lines: string[] } {
  if (diagnosis.state === 'complete') return { run: true };
  const why = { absent: 'o R2 não está configurado', partial: 'a configuração do R2 está incompleta', invalid: 'a configuração do R2 tem valores inválidos' }[diagnosis.state];
  return {
    run: false,
    lines: [
      `media:smoke RECUSADO — ${why}. Nada foi enviado nem consultado.`,
      ...formatR2Diagnosis(diagnosis),
      'Complete o R2 no .env.local (modelo em .env.example). MEDIA_BACKEND não precisa mudar: o smoke funciona com MEDIA_BACKEND=local.',
    ],
  };
}

/** Troca por *** qualquer ocorrência de chave de acesso, segredo ou endereço S3 (defesa em profundidade na saída). */
export function makeRedactor(settings: R2Settings): (text: string) => string {
  const secrets = new Set<string>([settings.accessKeyId, settings.secretAccessKey, settings.endpoint]);
  try {
    secrets.add(new URL(settings.endpoint).hostname);
  } catch {
    /* endpoint inválido: já coberto acima */
  }
  const list = [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  return (text) => list.reduce((acc, s) => acc.split(s).join('***'), text);
}

export function formatSmokeReport(report: SmokeReport, publicHost?: string): string[] {
  const lines = ['media:smoke — teste de ponta a ponta do R2 (um objeto descartável sob healthcheck/)', `objeto de teste: ${report.prefix}probe.txt`];
  if (publicHost) lines.push(`domínio público: ${publicHost}`);
  report.steps.forEach((s, i) => lines.push(`  ${s.status === 'pass' ? 'PASS' : s.status === 'fail' ? 'FAIL' : 'SKIP'}  ${i + 1} ${s.title} — ${s.detail}`));
  lines.push(`limpeza: ${{ deleted: 'objeto de teste apagado', not_needed: 'nada ficou no bucket', failed: `FALHOU — o objeto de teste pode ter ficado no bucket: apague ${report.prefix}probe.txt` }[report.cleanup]}`);
  lines.push(report.ok ? 'RESULTADO: PASS' : `RESULTADO: FAIL${report.failure ? ` — etapa "${report.failure.step}", causa: ${report.failure.group} (${report.failure.text})` : ' — limpeza incompleta'}`);
  return lines;
}
