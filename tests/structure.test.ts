import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fromPerfume } from '@perfumes/core/library';
import { sanitizePerfume, type Perfume } from '@perfumes/core/perfume';
import { entries, importJobs, productImages, products, productVariants, users } from '../apps/server/src/db/schema';
import seed from '../apps/web/src/data/seed.json';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));

/* ------------------------------------------------------------------ monorepo */

describe('estrutura do monorepo', () => {
  it('workspaces apps/web, apps/server e packages/core', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(root.workspaces).toEqual(['packages/*', 'apps/*']);
    expect(JSON.parse(readFileSync('packages/core/package.json', 'utf8')).name).toBe('@perfumes/core');
    expect(JSON.parse(readFileSync('apps/web/package.json', 'utf8')).name).toBe('@perfumes/web');
    expect(JSON.parse(readFileSync('apps/server/package.json', 'utf8')).name).toBe('@perfumes/server');
  });

  it('packages/core não depende de DOM, window, document, React, Node nem APIs de navegador', () => {
    const forbidden = [
      /\bwindow\./,
      /\bdocument\./,
      /\bnavigator\./,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bHTMLElement\b/,
      /\brequestAnimationFrame\b/,
      /\bfetch\(/,
      /\bprocess\./,
      /from ['"](react|react-dom|three)['"/]/,
      /from ['"]node:/,
      /require\(/,
    ];
    const found: string[] = [];
    for (const file of files('packages/core/src')) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const rule of forbidden) if (rule.test(code)) found.push(`${file}: ${rule}`);
      for (const [, spec] of code.matchAll(/from ['"]([^'"]+)['"]/g)) if (!spec!.startsWith('./')) found.push(`${file}: importa ${spec}`);
    }
    expect(found).toEqual([]);
  });

  it('o core compila sem a biblioteca DOM (tsconfig próprio)', () => {
    const cfg = readFileSync('packages/core/tsconfig.json', 'utf8');
    expect(cfg).toMatch(/"lib":\s*\["ES2023"\]/);
    expect(cfg).toMatch(/"types":\s*\[\]/);
  });

  it('web não importa o servidor, e o servidor não importa a interface', () => {
    const bad: string[] = [];
    for (const f of files('apps/web/src')) if (/from ['"][^'"]*apps\/server|from ['"]\.\.\/\.\.\/server/.test(readFileSync(f, 'utf8'))) bad.push(f);
    for (const f of files('apps/server/src')) if (/from ['"][^'"]*(apps\/web|\.\.\/web\/)/.test(readFileSync(f, 'utf8'))) bad.push(f);
    expect(bad).toEqual([]);
  });
});

/* ------------------------------------------------------------------ schema preliminar cobre o domínio */

describe('schema Postgres preliminar (sem conexão)', () => {
  const perfumes = (seed as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
  const { product, entry } = fromPerfume(perfumes[0]!, 'u1');
  const cols = (t: Parameters<typeof getTableColumns>[0]) => Object.keys(getTableColumns(t));

  it('toda propriedade de uma entrada tem coluna', () => {
    expect(cols(entries)).toEqual(expect.arrayContaining(Object.keys(entry)));
  });

  it('todo campo do produto tem lugar (colunas, variantes, imagens, aparência)', () => {
    const productCols = new Set(cols(products));
    const elsewhere: Record<string, string[]> = { variants: cols(productVariants), images: cols(productImages), appearance: [] };
    for (const key of Object.keys(product)) {
      if (key in elsewhere) continue;
      expect(productCols.has(key), `products.${key}`).toBe(true);
    }
    for (const key of Object.keys(product.appearance)) expect(productCols.has(key), `appearance.${key}`).toBe(true);
    for (const v of perfumes.flatMap((p) => p.variants)) for (const key of Object.keys(v)) expect(cols(productVariants)).toContain(key);
    // Imagem: url/thumbUrl/masterUrl viram chaves do armazenamento (key/thumbKey/masterKey).
    const imageCols = new Set(cols(productImages));
    const renamed: Record<string, string> = { url: 'key', thumbUrl: 'thumbKey', masterUrl: 'masterKey' };
    for (const img of product.images) for (const key of Object.keys(img)) expect(imageCols.has(renamed[key] ?? key), `images.${key}`).toBe(true);
  });

  it('usuários e jobs têm as colunas que o app usa', () => {
    expect(cols(users)).toEqual(expect.arrayContaining(['id', 'username', 'displayName', 'bio', 'privacyProfile', 'privacyWishlist', 'privacyCollection']));
    expect(cols(importJobs)).toEqual(expect.arrayContaining(['id', 'ownerId', 'status', 'input', 'progressPercent', 'result', 'error', 'attempts', 'startedAt', 'finishedAt']));
  });

  it('o servidor não abre conexão com banco nesta etapa', () => {
    const offenders = files('apps/server/src').filter((f) => /drizzle-orm\/(neon|node-postgres|postgres-js)|from ['"](pg|postgres|@neondatabase)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
