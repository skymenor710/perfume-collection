import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Configuração do servidor: tudo vem do ambiente (ou do .env.local deste computador), validado num lugar só.
 * Segredos (código de acesso do celular, chaves) nunca vão para o navegador nem para os logs — `describeConfig`
 * diz só QUAIS estão definidos. Valor inválido derruba o start com uma mensagem clara, em vez de falhar depois.
 */

/** Raiz do repositório, independente da pasta de onde o servidor foi iniciado (raiz ou apps/server). */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/**
 * O .env.local deste computador. `PERFUMES_ENV_FILE` (só no ambiente do processo, nunca dentro do próprio arquivo) troca
 * por outro arquivo: os testes das CLIs usam um arquivo temporário com valores fictícios e jamais abrem o .env.local real.
 */
const ENV_FILE = process.env.PERFUMES_ENV_FILE ? path.resolve(process.env.PERFUMES_ENV_FILE) : path.join(ROOT, '.env.local');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `VAR=` vazio no .env conta como "não definido". */
const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v), z.string().optional());
const intIn = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : Number(v)), z.number().int().min(min).max(max));

/** https, sem credenciais embutidas, sem ? nem #; `allowPath` libera um caminho-base (ex.: https://img.x.com/fotos). */
function isHttpsBase(value: string, allowPath: boolean): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && !value.includes('?') && !value.includes('#') && (allowPath || u.pathname === '/');
  } catch {
    return false;
  }
}

/** O que o R2 precisa para funcionar (sem isso, MEDIA_BACKEND=r2 não sobe). Mais: R2_ENDPOINT ou R2_ACCOUNT_ID. */
const R2_REQUIRED = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const;

export interface R2Settings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Sem barra no fim. */
  publicBaseUrl: string;
}

/* ------------------------------------------------------------------ R2: diagnóstico e validação (puros, sem rede) */

/** absent: nenhuma variável R2_*; partial: faltam componentes; invalid: há valor com formato/combinação inválida; complete: pronto. */
export type R2State = 'absent' | 'partial' | 'invalid' | 'complete';

export interface R2Component {
  /** Nome(s) da variável. Nunca o valor. */
  name: string;
  status: 'ok' | 'missing' | 'invalid';
  /** Frase fixa sobre o problema (nunca repete o valor recebido). */
  problem?: string;
}

export interface R2Diagnosis {
  state: R2State;
  components: R2Component[];
  /** Problemas de formato/combinação, por variável (para o start com MEDIA_BACKEND=r2). */
  problems: { name: string; message: string }[];
  /** Só quando completa e válida. Só o provedor (storage/r2.ts) usa as chaves. */
  settings: R2Settings | null;
}

type R2Vars = Partial<Record<'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET' | 'R2_ENDPOINT' | 'R2_PUBLIC_BASE_URL', string | undefined>>;

const clean = (v: string | undefined) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

/**
 * Diz o que falta ou está errado no R2, SEM rede e SEM mostrar valores. Regras:
 *   - Account ID: 32 hexadecimais; bucket: 3–63 (minúsculas, números, hífen);
 *   - R2_ENDPOINT: https, sem caminho (o bucket é anexado pelo provedor — com caminho o bucket apareceria duas vezes),
 *     sem usuário/senha/?/#. Jurisdições (`<conta>.eu.r2…`, `<conta>.fedramp.r2…`) são aceitas; bucket criado com
 *     jurisdição exige o endpoint dela EXPLÍCITO (o derivado do Account ID é o padrão, sem jurisdição);
 *   - se R2_ENDPOINT traz um Account ID, ele tem de ser o de R2_ACCOUNT_ID;
 *   - R2_PUBLIC_BASE_URL: https, sem usuário/senha/?/#, sem "//" no caminho; NÃO pode ser o endereço S3 (mesma origem que
 *     o endpoint, ou qualquer `*.r2.cloudflarestorage.com`) e NÃO pode conter o nome do bucket no caminho (o endereço
 *     público — r2.dev ou domínio próprio — já aponta para a raiz do bucket).
 */
export function diagnoseR2(raw: R2Vars): R2Diagnosis {
  const v = {
    account: clean(raw.R2_ACCOUNT_ID),
    keyId: clean(raw.R2_ACCESS_KEY_ID),
    secret: clean(raw.R2_SECRET_ACCESS_KEY),
    bucket: clean(raw.R2_BUCKET),
    endpoint: clean(raw.R2_ENDPOINT),
    pub: clean(raw.R2_PUBLIC_BASE_URL),
  };
  const problems = new Map<string, string>();
  if (v.account && !ACCOUNT_ID.test(v.account)) problems.set('R2_ACCOUNT_ID', 'precisa ser o Account ID do Cloudflare (32 caracteres hexadecimais)');
  if (v.bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v.bucket)) problems.set('R2_BUCKET', 'nome de bucket inválido (3 a 63 caracteres: minúsculas, números e hífen)');
  if (v.endpoint && !isHttpsBase(v.endpoint, false)) problems.set('R2_ENDPOINT', 'precisa ser https://… sem caminho, usuário, senha, ? ou #');
  if (v.pub && !isHttpsBase(v.pub, true)) problems.set('R2_PUBLIC_BASE_URL', 'precisa ser https://… sem usuário, senha, ? ou #');

  // Combinações (só quando as partes são válidas).
  if (v.endpoint && v.account && !problems.has('R2_ENDPOINT') && !problems.has('R2_ACCOUNT_ID')) {
    const label = new URL(v.endpoint).hostname.split('.')[0]!;
    if (ACCOUNT_ID.test(label) && label.toLowerCase() !== v.account.toLowerCase()) problems.set('R2_ENDPOINT', 'é de outra conta: o identificador no endereço é diferente de R2_ACCOUNT_ID');
  }
  const derived = v.account && !problems.has('R2_ACCOUNT_ID') ? `https://${v.account.toLowerCase()}.r2.cloudflarestorage.com` : undefined;
  const endpoint = v.endpoint && !problems.has('R2_ENDPOINT') ? v.endpoint : derived;
  if (v.pub && !problems.has('R2_PUBLIC_BASE_URL')) {
    const u = new URL(v.pub);
    if (u.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com') || (endpoint && u.origin === new URL(endpoint).origin)) {
      problems.set('R2_PUBLIC_BASE_URL', 'é o endereço S3 do R2 (privado, exige assinatura): use o endereço público do bucket (r2.dev ou domínio próprio)');
    } else if (u.pathname.replace(/\/+$/, '').includes('//')) {
      // Barras repetidas no FIM são normalizadas; no MEIO do caminho são erro (a URL de cada foto sairia com "//").
      problems.set('R2_PUBLIC_BASE_URL', 'o caminho não pode ter barras duplicadas');
    } else if (v.bucket && !problems.has('R2_BUCKET') && u.pathname.split('/').includes(v.bucket)) {
      problems.set('R2_PUBLIC_BASE_URL', 'não inclua o nome do bucket no caminho: o endereço público já aponta para a raiz do bucket');
    }
  }

  const one = (name: string, present: boolean): R2Component => {
    const problem = problems.get(name);
    return problem ? { name, status: 'invalid', problem } : { name, status: present ? 'ok' : 'missing' };
  };
  const endpointProblem = problems.get('R2_ENDPOINT') ?? problems.get('R2_ACCOUNT_ID');
  const components: R2Component[] = [
    one('R2_ACCESS_KEY_ID', Boolean(v.keyId)),
    one('R2_SECRET_ACCESS_KEY', Boolean(v.secret)),
    one('R2_BUCKET', Boolean(v.bucket)),
    one('R2_PUBLIC_BASE_URL', Boolean(v.pub)),
    endpointProblem ? { name: 'R2_ENDPOINT ou R2_ACCOUNT_ID', status: 'invalid', problem: endpointProblem } : { name: 'R2_ENDPOINT ou R2_ACCOUNT_ID', status: v.endpoint || v.account ? 'ok' : 'missing' },
  ];
  const anySet = Object.values(v).some(Boolean);
  const state: R2State = !anySet ? 'absent' : problems.size > 0 ? 'invalid' : components.some((c) => c.status === 'missing') ? 'partial' : 'complete';
  const settings: R2Settings | null =
    state === 'complete'
      ? { endpoint: (v.endpoint ?? derived!).replace(/\/+$/, ''), bucket: v.bucket!, accessKeyId: v.keyId!, secretAccessKey: v.secret!, publicBaseUrl: v.pub!.replace(/\/+$/, '') }
      : null;
  const diagnosis = { state, components, problems: [...problems].map(([name, message]) => ({ name, message })) } as R2Diagnosis;
  // `settings` guarda a chave e o segredo: fica NÃO enumerável, para que JSON.stringify, console.log ou um log
  // descuidado do diagnóstico inteiro nunca os mostrem. Quem precisa (o provedor) lê `.settings` de propósito.
  Object.defineProperty(diagnosis, 'settings', { value: settings, enumerable: false });
  return diagnosis;
}

/** Linhas para o terminal: estado + um componente por linha (nome e situação; nunca valores). */
export function formatR2Diagnosis(d: R2Diagnosis): string[] {
  const label = { absent: 'nenhuma variável R2_* definida', partial: 'INCOMPLETO — faltam componentes', invalid: 'INVÁLIDO — há valor com formato ou combinação errada', complete: 'completo e válido' }[d.state];
  const mark = { ok: 'ok', missing: 'AUSENTE', invalid: 'INVÁLIDO' } as const;
  return [`R2: ${label}`, ...d.components.map((c) => `  ${mark[c.status].padEnd(8)} ${c.name}${c.problem ? ` — ${c.problem}` : ''}`)];
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PERFUMES_PORT: intIn(1, 65_535, 3100),
  PERFUMES_HOST: optionalText,
  PERFUMES_DATA_DIR: optionalText,
  PERFUMES_MODELS_DIR: optionalText,
  PERFUMES_ACCESS_CODE: optionalText,
  PERFUMES_USERNAME: optionalText,
  PERFUMES_DISPLAY_NAME: optionalText,
  PERFUMES_PUBLIC_ORIGIN: optionalText.refine((v) => v === undefined || /^https?:\/\/[^/]+/i.test(v), 'precisa ser uma origem http(s), ex.: https://perfumes.exemplo.com'),
  LOG_LEVEL: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  EGRESS_MAX_CONCURRENT: intIn(1, 64, 6),
  EGRESS_MAX_PER_MINUTE: intIn(1, 10_000, 120),
  SEARCH_PROVIDER_KEY: optionalText,
  BRAVE_SEARCH_API_KEY: optionalText,
  DEBUG_CUTOUT: optionalText,
  /** Fontes desligadas, separadas por vírgula (ids de sources/registry.ts). */
  SOURCES_DISABLED: optionalText,
  // Produção (FASE 2+). Validados desde já para o formato não surpreender no dia da virada; o app ainda não os usa.
  /** Fonte oficial da biblioteca: json (data/library.json) ou postgres (DATABASE_URL). */
  STORAGE_BACKEND: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['json', 'postgres']).default('json')),
  /** postgres://… (Neon) ou, só fora de produção, pglite:<pasta> (Postgres local de ensaio). */
  DATABASE_URL: optionalText.refine((v) => v === undefined || /^postgres(ql)?:\/\//.test(v) || v.startsWith('pglite:'), 'precisa começar com postgres:// (ou pglite: fora de produção)'),
  /** Conexão direta (sem pooler) para aplicar migrations. Opcional: sem ela, usa DATABASE_URL. */
  DATABASE_URL_UNPOOLED: optionalText.refine((v) => v === undefined || /^postgres(ql)?:\/\//.test(v) || v.startsWith('pglite:'), 'precisa começar com postgres://'),
  /** Id do dono desta instalação no banco (só necessário quando houver mais de um usuário). */
  PERFUMES_OWNER_ID: optionalText,
  /** Banco de TESTES: URL de um branch separado do Neon e o nome exato do database esperado nela (proteção extra). */
  TEST_DATABASE_URL: optionalText,
  NEON_TEST_DATABASE_NAME: optionalText,
  /** Onde as fotos são servidas (FASE 3): local (data/media + apps/web/public/bottles, como sempre) ou r2. */
  MEDIA_BACKEND: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['local', 'r2']).default('local')),
  /**
   * Com MEDIA_BACKEND=r2, foto que ainda NÃO está validada no R2: none (padrão) = 404 + log de erro; local = serve a
   * cópia local conferida pelo SHA-256, com log de aviso. Nunca é silencioso.
   */
  MEDIA_FALLBACK: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['none', 'local']).default('none')),
  // R2_*: o FORMATO só derruba o start com MEDIA_BACKEND=r2 (superRefine abaixo, por `diagnoseR2`). Em modo local o R2 é
  // inativo: um valor errado ali não derruba o app — aparece no log de partida e no diagnóstico (media:smoke --diagnose).
  R2_ACCOUNT_ID: optionalText,
  R2_ACCESS_KEY_ID: optionalText,
  R2_SECRET_ACCESS_KEY: optionalText,
  R2_BUCKET: optionalText,
  /** Endpoint S3 do R2. Opcional: sem ele, https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com (sem jurisdição). */
  R2_ENDPOINT: optionalText,
  /** Endereço público das fotos (domínio img. ou r2.dev). É a única origem de imagem que o CSP libera além do app. */
  R2_PUBLIC_BASE_URL: optionalText,
  AUTH_SECRET: optionalText.refine((v) => v === undefined || v.length >= 32, 'precisa ter pelo menos 32 caracteres'),
  EMAIL_PROVIDER_KEY: optionalText,
  SENTRY_DSN: optionalText,
});

export type Env = z.infer<typeof envSchema>;

/** Nomes que guardam segredo: aparecem nos logs só como "definido". */
export const SECRET_KEYS = ['PERFUMES_ACCESS_CODE', 'SEARCH_PROVIDER_KEY', 'BRAVE_SEARCH_API_KEY', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'TEST_DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'AUTH_SECRET', 'EMAIL_PROVIDER_KEY', 'SENTRY_DSN'] as const;

export class ConfigError extends Error {}

/** Valida um ambiente (puro: os testes passam objetos, o servidor passa process.env). */
export function parseEnv(env: Record<string, string | undefined>): Env {
  const result = envSchema
    .superRefine((e, ctx) => {
      if (e.STORAGE_BACKEND === 'postgres' && !e.DATABASE_URL) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obrigatória com STORAGE_BACKEND=postgres' });
      if (e.NODE_ENV === 'production' && e.DATABASE_URL?.startsWith('pglite:')) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'pglite: é só para ensaio local, nunca em produção' });
      if (e.MEDIA_BACKEND === 'r2') {
        // Com R2 ativo, QUALQUER falha de configuração impede a partida, com os nomes (nunca os valores).
        for (const p of diagnoseR2(e).problems) ctx.addIssue({ code: 'custom', path: [p.name], message: p.message });
        for (const k of R2_REQUIRED) if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'obrigatória com MEDIA_BACKEND=r2' });
        if (!e.R2_ENDPOINT && !e.R2_ACCOUNT_ID) ctx.addIssue({ code: 'custom', path: ['R2_ENDPOINT'], message: 'obrigatória com MEDIA_BACKEND=r2 (ou R2_ACCOUNT_ID)' });
      }
    })
    .safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Configuração inválida:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Lê o .env.local (sem aplicar e sem imprimir nada). Linhas vazias e comentários são ignorados. */
export function readEnvFile(file = ENV_FILE): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value) out[match[1]] = value;
  }
  return out;
}

function loadEnvFile() {
  for (const [key, value] of Object.entries(readEnvFile())) if (process.env[key] === undefined) process.env[key] = value;
}

let cached: Env | null = null;
const env = () => (cached ??= parseEnv(process.env));

/** Relê o ambiente (depois de carregar o .env.local, ou em testes). */
export function reloadConfig(): Env {
  cached = null;
  return env();
}

/** Primeira execução: cria o código que libera o celular na mesma rede Wi-Fi. */
export function ensureLocalConfig() {
  loadEnvFile();
  if (!process.env.PERFUMES_ACCESS_CODE) {
    const code = Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    process.env.PERFUMES_ACCESS_CODE = code;
    const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').trimEnd() : '# Configuração local da coleção de perfumes. Não versionar.';
    writeFileSync(ENV_FILE, `${current}\n\n# Código para abrir a coleção no celular (mesma rede Wi-Fi).\nPERFUMES_ACCESS_CODE=${code}\n`, { mode: 0o600 });
  }
  reloadConfig();
  mkdirSync(config.mediaDir, { recursive: true });
}

/** O que está configurado, sem nenhum valor secreto (para o log de início). */
export function describeConfig(e: Env = env()) {
  const set = (k: keyof Env) => e[k] !== undefined;
  return {
    port: e.PERFUMES_PORT,
    host: e.PERFUMES_HOST,
    publicOrigin: config.publicOrigin,
    logLevel: e.LOG_LEVEL,
    egress: { maxConcurrent: e.EGRESS_MAX_CONCURRENT, maxPerMinute: e.EGRESS_MAX_PER_MINUTE },
    storageBackend: e.STORAGE_BACKEND,
    // Só o TIPO do banco; a URL nunca.
    database: e.DATABASE_URL ? (e.DATABASE_URL.startsWith('pglite:') ? 'pglite' : 'postgres') : null,
    // Fotos: só o modo, o estado do R2 e QUAIS componentes precisam de atenção; nenhuma chave, bucket, endereço ou valor.
    media: { backend: e.MEDIA_BACKEND, fallback: e.MEDIA_FALLBACK, r2Configured: r2From(e) !== null, r2State: diagnoseR2(e).state, r2Attention: r2Attention(e) },
    secretsDefined: SECRET_KEYS.filter((k) => set(k)),
  };
}

/** Configuração completa E válida do R2, ou nulo. Só o provedor (storage/r2.ts) usa as chaves; nunca vão para log ou erro. */
function r2From(e: Env): R2Settings | null {
  return diagnoseR2(e).settings;
}

/** "NOME: ausente|inválido" dos componentes que precisam de atenção (só com R2 parcial ou inválido; vazio se tudo ausente/ok). */
function r2Attention(e: Env): string[] {
  const d = diagnoseR2(e);
  if (d.state === 'absent' || d.state === 'complete') return [];
  return d.components.filter((c) => c.status !== 'ok').map((c) => `${c.name}: ${c.status === 'missing' ? 'ausente' : 'inválido'}`);
}

export const config = {
  get env() {
    return env().NODE_ENV;
  },
  get port() {
    return env().PERFUMES_PORT;
  },
  /** Usuário dono desta instalação (enquanto não há contas): vira /username. Mudável por PATCH /api/me. */
  get ownerUsername() {
    return env().PERFUMES_USERNAME || 'guilherme';
  },
  get ownerDisplayName() {
    return env().PERFUMES_DISPLAY_NAME || 'Guilherme';
  },
  /**
   * Endereço público (ex.: https://perfumes.exemplo.com) quando o app for hospedado: aceito no Host e usado nos links
   * canônicos e nas prévias (Open Graph). Vazio = só este PC e a Wi-Fi.
   */
  get publicOrigin() {
    const raw = env().PERFUMES_PUBLIC_ORIGIN;
    try {
      return raw ? new URL(raw).origin : null;
    } catch {
      return null;
    }
  },
  /** 0.0.0.0 deixa o celular na mesma rede abrir (depois do código de acesso). */
  get host() {
    return env().PERFUMES_HOST || '0.0.0.0';
  },
  get dataDir() {
    return env().PERFUMES_DATA_DIR || path.join(ROOT, 'data');
  },
  /** O modelo de recorte (224 MB) fica no projeto, não nos dados: coleções de teste não baixam de novo. */
  get modelsDir() {
    return env().PERFUMES_MODELS_DIR || path.join(ROOT, 'data', 'models');
  },
  get mediaDir() {
    return path.join(this.dataDir, 'media');
  },
  get distDir() {
    return path.join(ROOT, 'apps', 'web', 'dist');
  },
  get seedFile() {
    return path.join(ROOT, 'apps', 'web', 'src', 'data', 'seed.json');
  },
  get accessCode() {
    return env().PERFUMES_ACCESS_CODE ?? '';
  },
  get logLevel() {
    return env().LOG_LEVEL;
  },
  /** Teto de saída para a internet, somando todas as fontes (proteção contra abuso e contra virar robô agressivo). */
  get egress() {
    return { maxConcurrent: env().EGRESS_MAX_CONCURRENT, maxPerMinute: env().EGRESS_MAX_PER_MINUTE };
  },
  /** Chave do buscador (Brave Search API). O nome antigo continua aceito. */
  get searchApiKey() {
    return env().SEARCH_PROVIDER_KEY ?? env().BRAVE_SEARCH_API_KEY ?? '';
  },
  get sourcesDisabled(): string[] {
    return (env().SOURCES_DISABLED ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get storageBackend() {
    return env().STORAGE_BACKEND;
  },
  get databaseUrl() {
    return env().DATABASE_URL ?? '';
  },
  /** Para migrations: conexão direta quando existir. */
  get migrationDatabaseUrl() {
    return env().DATABASE_URL_UNPOOLED ?? env().DATABASE_URL ?? '';
  },
  get ownerId() {
    return env().PERFUMES_OWNER_ID ?? null;
  },
  /** Onde as fotos são servidas: local (padrão) ou r2. */
  get mediaBackend() {
    return env().MEDIA_BACKEND;
  },
  get mediaFallback() {
    return env().MEDIA_FALLBACK;
  },
  get r2(): R2Settings | null {
    return r2From(env());
  },
  /** Situação do R2 (componentes ausentes/inválidos), sem nenhum valor. */
  get r2Diagnosis(): R2Diagnosis {
    return diagnoseR2(env());
  },
  /** Mapa referência antiga → SHA-256 → chave do R2 (media/map.ts). Mora nos dados, junto dos backups. */
  get mediaMapFile() {
    return path.join(this.dataDir, 'media-map.json');
  },
  get root() {
    return ROOT;
  },
  get debugCutout() {
    return Boolean(env().DEBUG_CUTOUT);
  },
};
