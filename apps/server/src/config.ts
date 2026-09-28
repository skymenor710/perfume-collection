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
const ENV_FILE = path.join(ROOT, '.env.local');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `VAR=` vazio no .env conta como "não definido". */
const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v), z.string().optional());
const intIn = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : Number(v)), z.number().int().min(min).max(max));

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
  R2_ACCOUNT_ID: optionalText,
  R2_ACCESS_KEY_ID: optionalText,
  R2_SECRET_ACCESS_KEY: optionalText,
  R2_BUCKET: optionalText,
  R2_PUBLIC_URL: optionalText.refine((v) => v === undefined || /^https:\/\//.test(v), 'precisa ser https://'),
  AUTH_SECRET: optionalText.refine((v) => v === undefined || v.length >= 32, 'precisa ter pelo menos 32 caracteres'),
  EMAIL_PROVIDER_KEY: optionalText,
  SENTRY_DSN: optionalText,
});

export type Env = z.infer<typeof envSchema>;

/** Nomes que guardam segredo: aparecem nos logs só como "definido". */
export const SECRET_KEYS = ['PERFUMES_ACCESS_CODE', 'SEARCH_PROVIDER_KEY', 'BRAVE_SEARCH_API_KEY', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'AUTH_SECRET', 'EMAIL_PROVIDER_KEY', 'SENTRY_DSN'] as const;

export class ConfigError extends Error {}

/** Valida um ambiente (puro: os testes passam objetos, o servidor passa process.env). */
export function parseEnv(env: Record<string, string | undefined>): Env {
  const result = envSchema
    .superRefine((e, ctx) => {
      if (e.STORAGE_BACKEND === 'postgres' && !e.DATABASE_URL) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obrigatória com STORAGE_BACKEND=postgres' });
      if (e.NODE_ENV === 'production' && e.DATABASE_URL?.startsWith('pglite:')) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'pglite: é só para ensaio local, nunca em produção' });
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
    secretsDefined: SECRET_KEYS.filter((k) => set(k)),
  };
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
  get root() {
    return ROOT;
  },
  get debugCutout() {
    return Boolean(env().DEBUG_CUTOUT);
  },
};
