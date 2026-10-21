import { defineConfig } from 'vite';

// Construit uniquement les fichiers du NAVIGATEUR (JS + CSS avec empreinte) dans dist/client.
// Le HTML est rendu par le serveur (Hono) ; public/ (marque, polices) est copié tel quel.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // À la racine pour que Netlify puisse l'inclure dans le paquet de la fonction
    // (les répertoires cachés comme `.vite/` ne sont pas fiables dans ce bundle).
    manifest: 'manifest.json',
    target: 'es2022',
    cssMinify: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { site: 'src/client/site.ts', admin: 'src/client/admin.ts' },
    },
  },
});
