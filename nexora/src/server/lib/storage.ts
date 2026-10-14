import { mkdir, readFile, rm, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import type { Config } from '../config';

/**
 * Stockage persistant des fichiers (images des projets).
 *   local : dossier sur disque persistant (serveur dédié / VPS / volume monté) — jamais /tmp.
 *   s3    : tout service compatible S3 (Cloudflare R2, Scaleway, OVH, AWS S3).
 * Les clés sont générées par le serveur (jamais à partir d'un nom de fichier envoyé).
 */
export interface Storage {
  kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  deletePrefix(prefix: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error('Clé de stockage invalide');
}

export function createStorage(config: Config['storage']): Storage {
  return config.driver === 's3' ? s3Storage(config) : localStorageDriver(config.dir);
}

function localStorageDriver(dir: string): Storage {
  const root = path.resolve(dir);
  const resolve = (key: string) => {
    assertSafeKey(key);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Clé de stockage invalide');
    return full;
  };
  return {
    kind: 'local',
    async put(key, body) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      // Écriture atomique : fichier temporaire puis renommage.
      const tmp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, full);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async deletePrefix(prefix) {
      const full = resolve(prefix.replace(/\/+$/, ''));
      await rm(full, { recursive: true, force: true });
    },
    async list(prefix) {
      const base = resolve(prefix.replace(/\/+$/, ''));
      const out: string[] = [];
      async function walk(d: string) {
        let entries;
        try {
          entries = await readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else if (!e.name.endsWith('.tmp')) out.push(path.relative(root, p).split(path.sep).join('/'));
        }
      }
      await walk(base);
      return out.sort();
    },
  };
}

function s3Storage(c: Extract<Config['storage'], { driver: 's3' }>): Storage {
  const client = new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: 's3', region: c.region });
  const objectUrl = (key: string) => {
    assertSafeKey(key);
    return `${c.endpoint}/${encodeURIComponent(c.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  };
  async function list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const u = new URL(`${c.endpoint}/${encodeURIComponent(c.bucket)}`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (token) u.searchParams.set('continuation-token', token);
      const res = await client.fetch(u.toString());
      if (!res.ok) throw new Error(`Stockage S3 : liste impossible (HTTP ${res.status})`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]));
      const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? decodeXml(next[1]) : undefined;
    } while (token);
    return keys;
  }
  return {
    kind: 's3',
    async put(key, body, contentType) {
      const res = await client.fetch(objectUrl(key), {
        method: 'PUT',
        body: new Uint8Array(body),
        headers: { 'content-type': contentType, 'content-length': String(body.length) },
      });
      if (!res.ok) throw new Error(`Stockage S3 : envoi impossible (HTTP ${res.status})`);
    },
    async get(key) {
      const res = await client.fetch(objectUrl(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Stockage S3 : lecture impossible (HTTP ${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async deletePrefix(prefix) {
      for (const key of await list(prefix)) {
        const res = await client.fetch(objectUrl(key), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`Stockage S3 : suppression impossible (HTTP ${res.status})`);
      }
    },
    list,
  };
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
