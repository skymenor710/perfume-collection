import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Caminhos relativos: o mesmo código serve no computador (npm start) e como página publicada no claude.ai.
// `--mode artifact` monta a variante do link: um arquivo só (JS, CSS e fonte embutidos) e sem three.js.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    // Servidor: base absoluta (a página pode estar em /guilherme/wishlist). claude.ai: relativa, como a plataforma exige.
    base: artifact ? './' : '/',
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'react' },
    },
    resolve: {
      alias: artifact ? [{ find: /^\.\/ModelBottle$/, replacement: fileURLToPath(new URL('./src/components/ModelBottle.artifact.tsx', import.meta.url)) }] : [],
    },
    build: {
      outDir: artifact ? 'dist-artifact/build' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: false,
      cssCodeSplit: false,
      // Fontes viram data: URI no link (a página publicada só carrega fonte do Google Fonts ou embutida).
      assetsInlineLimit: artifact ? (file: string) => /\.woff2$/.test(file) && !/vietnamese/.test(file) : 0,
      copyPublicDir: !artifact,
      chunkSizeWarningLimit: 700,
      rolldownOptions: artifact ? { output: { codeSplitting: false } } : undefined,
    },
    server: {
      port: 5173,
      strictPort: true,
      // No `npm run dev`, a API vem do servidor local (`npm run server`), com a mesma origem que ele confere.
      proxy: {
        '/api': {
          target: 'http://localhost:3100',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (request) => {
              if (request.getHeader('origin')) request.setHeader('origin', 'http://localhost:3100');
            });
          },
        },
        '/media': { target: 'http://localhost:3100', changeOrigin: true },
      },
    },
  };
});
