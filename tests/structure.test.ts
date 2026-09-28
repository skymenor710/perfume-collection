import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

/* ------------------------------------------------------------------ banco: um lugar só conhece o driver */

describe('acesso ao banco centralizado', () => {
  it('só db/client.ts importa drivers de Postgres (pg, PGlite); o resto fala com o repositório', () => {
    const offenders = files('apps/server/src').filter(
      (f) =>
        !f.replace(/\\/g, '/').endsWith('db/client.ts') &&
        /(from|import\()\s*['"](pg|postgres|@neondatabase\/[^'"]+|@electric-sql\/pglite|drizzle-orm\/(neon[^'"]*|node-postgres[^'"]*|postgres-js|pglite[^'"]*))['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('rotas e jobs não importam o schema nem o banco diretamente', () => {
    const offenders = [...files('apps/server/src/http'), ...files('apps/server/src/jobs')].filter((f) => /from ['"](\.\.?\/)+db\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
