import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuração do servidor local. Segredos (o código de acesso do celular) vivem só no .env.local
 * deste computador e nunca vão para o navegador.
 */

/** Raiz do repositório, independente da pasta de onde o servidor foi iniciado (raiz ou apps/server). */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENV_FILE = path.join(ROOT, '.env.local');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
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
  mkdirSync(config.mediaDir, { recursive: true });
}

export const config = {
  get port() {
    return Number(process.env.PERFUMES_PORT) || 3100;
  },
  /** Usuário dono desta instalação (enquanto não há contas): vira /username. Mudável por PATCH /api/me. */
  get ownerUsername() {
    return process.env.PERFUMES_USERNAME?.trim() || 'guilherme';
  },
  get ownerDisplayName() {
    return process.env.PERFUMES_DISPLAY_NAME?.trim() || 'Guilherme';
  },
  /**
   * Endereço público (ex.: https://perfumes.exemplo.com) quando o app for hospedado: aceito no Host e usado nos links
   * canônicos e nas prévias (Open Graph). Vazio = só este PC e a Wi-Fi.
   */
  get publicOrigin() {
    const raw = process.env.PERFUMES_PUBLIC_ORIGIN?.trim();
    try {
      return raw ? new URL(raw).origin : null;
    } catch {
      return null;
    }
  },
  /** 0.0.0.0 deixa o celular na mesma rede abrir (depois do código de acesso). */
  get host() {
    return process.env.PERFUMES_HOST || '0.0.0.0';
  },
  get dataDir() {
    return process.env.PERFUMES_DATA_DIR || path.join(ROOT, 'data');
  },
  /** O modelo de recorte (224 MB) fica no projeto, não nos dados: coleções de teste não baixam de novo. */
  get modelsDir() {
    return process.env.PERFUMES_MODELS_DIR || path.join(ROOT, 'data', 'models');
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
    return process.env.PERFUMES_ACCESS_CODE?.trim() ?? '';
  },
};
