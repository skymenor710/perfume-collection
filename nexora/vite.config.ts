import { defineConfig } from 'vite';

// Construit uniquement les fichiers du NAVIGATEUR (JS + CSS avec empreinte) dans dist/client.
// Le HTML est rendu par le serveur (Hono) ; public/ (marque, polices) est copié tel quel.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
    target: 'es2022',
    cssMinify: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { site: 'src/client/site.ts', admin: 'src/client/admin.ts' },
    },
  },
});
