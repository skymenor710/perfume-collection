import http from 'node:http';
import { config, ensureLocalConfig } from './config';
import { createHandler } from './http/app';
import { localAddresses } from './http/guard';
import { collectMediaGarbage } from './media/gc';
import { loadStore, store } from './store';

/**
 * Coleção de perfumes no computador: serve o app e faz o que o navegador sozinho não consegue —
 * abrir a página de uma loja, baixar a foto do frasco, recortar o fundo e achar a cor.
 */

ensureLocalConfig();
loadStore();

// Mídia órfã (fotos que nenhum perfume usa) sai na partida e a cada 6 h.
const sweep = () => {
  const { removed, bytes } = collectMediaGarbage(store.referenced());
  if (removed) console.log(`[mídia] ${removed} arquivos sem uso removidos (${Math.round(bytes / 1024)} KB).`);
};
sweep();
setInterval(sweep, 6 * 60 * 60 * 1000).unref();

const handle = createHandler();
const server = http.createServer((req, res) => void handle(req, res));
server.requestTimeout = 2 * 60_000;

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `\nA porta ${config.port} já está em uso. Feche a outra janela ou defina PERFUMES_PORT com outra porta.\n`
      : `\nNão consegui iniciar: ${error.message}\n`,
  );
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const lan = config.host === '0.0.0.0' ? localAddresses() : [];
  console.log(
    [
      '',
      'Coleção de perfumes rodando.',
      '',
      `  Neste computador:  http://localhost:${config.port}`,
      ...lan.map((a, i) => `  ${i === 0 ? 'No celular:       ' : '                  '} http://${a}:${config.port}`),
      ...(lan.length ? [`  Código de acesso:  ${config.accessCode}   (pedido uma vez em cada aparelho, mesma rede Wi-Fi)`] : []),
      '',
      '  Para parar: Ctrl+C',
      '',
    ].join('\n'),
  );
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
