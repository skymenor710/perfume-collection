import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Fichiers produits par Vite (noms avec empreinte → cache navigateur d'un an).
 * Sans build (tests unitaires), des noms de repli sont utilisés.
 */
export interface Assets {
  clientDir: string;
  siteJs: string;
  siteCss: string[];
  adminJs: string;
  adminCss: string[];
  /** CSS du site public, intégré dans la page (évite une requête bloquante) et autorisé par son empreinte CSP. */
  siteInlineCss?: string;
  siteInlineCssHash?: string;
  built: boolean;
}

interface ManifestEntry {
  file: string;
  css?: string[];
}

export function loadAssets(clientDir: string): Assets {
  const manifestPath = path.join(clientDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { clientDir, siteJs: '/assets/site.js', siteCss: [], adminJs: '/assets/admin.js', adminCss: [], built: false };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestEntry>;
  const entry = (name: string) => {
    const e = manifest[name];
    if (!e) throw new Error(`Entrée ${name} absente du manifeste Vite`);
    return { js: `/${e.file}`, css: (e.css ?? []).map((c) => `/${c}`) };
  };
  const site = entry('src/client/site.ts');
  const admin = entry('src/client/admin.ts');
  const css = site.css.map((href) => readFileSync(path.join(clientDir, href), 'utf8')).join('\n');
  return {
    clientDir,
    siteJs: site.js,
    siteCss: site.css,
    adminJs: admin.js,
    adminCss: admin.css,
    siteInlineCss: css,
    siteInlineCssHash: `'sha256-${createHash('sha256').update(css).digest('base64')}'`,
    built: true,
  };
}
