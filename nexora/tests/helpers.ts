import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../src/server/config';
import { applyMigrations, openDb, type DbHandle } from '../src/server/db/client';
import { createLogger } from '../src/server/log';
import { createStorage } from '../src/server/lib/storage';
import type { Mailer } from '../src/server/lib/mail';
import { createMailer } from '../src/server/lib/mail';
import type { Deps } from '../src/server/context';
import { createApp } from '../src/server/app';
import { admins } from '../src/server/db/schema';
import { hashPassword, issueFormTokenForTest } from './token';

export const ORIGIN = 'http://localhost';
export const SECRET = 'test-secret-'.padEnd(48, 'x');

export interface TestCtx {
  deps: Deps;
  app: ReturnType<typeof createApp>;
  handle: DbHandle;
  dir: string;
  sent: { subject: string; text: string }[];
  close(): Promise<void>;
}

export async function setup(opts: { mail?: 'none' | 'ok' | 'fail' } = {}): Promise<TestCtx> {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexora-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: ORIGIN,
    TRUST_PROXY: 'true',
    DATABASE_URL: 'pglite:memory',
    SESSION_SECRET: SECRET,
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: path.join(dir, 'uploads'),
    LOG_LEVEL: 'silent',
    UPLOAD_MAX_MB: '2',
  });
  const handle = await openDb(config.databaseUrl);
  await applyMigrations(handle);
  const sent: { subject: string; text: string }[] = [];
  let mailer: Mailer = createMailer(config.mail);
  if (opts.mail === 'ok') mailer = { configured: true, send: async (m) => void sent.push(m) };
  if (opts.mail === 'fail') mailer = { configured: true, send: async () => { throw new Error('Fournisseur e-mail : HTTP 500'); } };
  const deps: Deps = {
    config,
    db: handle.db,
    storage: createStorage(config.storage),
    log: createLogger('silent'),
    mailer,
    assets: { clientDir: path.join(dir, 'client'), siteJs: '/assets/site.js', siteCss: [], adminJs: '/assets/admin.js', adminCss: [], built: false },
  };
  const app = createApp(deps);
  return {
    deps,
    app,
    handle,
    dir,
    sent,
    async close() {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const ADMIN_EMAIL = 'admin@nexora.test';
export const ADMIN_PASSWORD = 'Un-Mot-De-Passe-Solide-2026';

export async function createAdmin(ctx: TestCtx, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await ctx.deps.db.insert(admins).values({ email, passwordHash: await hashPassword(password) });
}

/** Petit « navigateur » : garde les cookies entre les requêtes. */
export class Client {
  cookies = new Map<string, string>();
  constructor(
    private ctx: TestCtx,
    public ip = '203.0.113.10',
  ) {}
  async req(pathname: string, init: RequestInit & { origin?: string | null } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    headers.set('x-forwarded-for', this.ip);
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
    const res = await this.ctx.app.request(pathname, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }
  form(pathname: string, data: Record<string, string>, extra: RequestInit & { origin?: string | null } = {}) {
    return this.req(pathname, {
      method: 'POST',
      body: new URLSearchParams(data).toString(),
      ...extra,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(extra.headers as Record<string, string>) },
    });
  }
  async login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
    const page = await this.req('/admin/connexion');
    const html = await page.text();
    const pre = /name="_pre" value="([^"]+)"/.exec(html)?.[1] ?? '';
    return this.form('/admin/connexion', { _pre: pre, email, password });
  }
  async csrf(pathname = '/admin') {
    const html = await (await this.req(pathname)).text();
    const t = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
    if (!t) throw new Error('csrf token absent');
    return t;
  }
}

export function contactPayload(overrides: Record<string, string> = {}) {
  return {
    name: 'Camille Martin',
    company: 'Atelier Martin',
    email: 'camille@example.fr',
    phone: '+33 6 12 34 56 78',
    projectType: 'Site vitrine',
    message: 'Bonjour, nous souhaitons refaire notre site vitrine.',
    website: '',
    token: issueFormTokenForTest(SECRET, Date.now() - 5000),
    ...overrides,
  };
}

export async function pngBuffer(w = 800, h = 800, color = { r: 117, g: 27, b: 53 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}
