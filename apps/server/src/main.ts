import http from 'node:http';
import { config, ConfigError, describeConfig, ensureLocalConfig } from './config';
import { createHandler } from './http/app';
import { localAddresses } from './http/guard';
import { event, log } from './log';
import { collectMediaGarbage } from './media/gc';
import { loadStore, store } from './store';

/**
 * Coleção de perfumes no computador: serve o app e faz o que o navegador sozinho não consegue —
 * abrir a página de uma loja, baixar a foto do frasco, recortar o fundo e achar a cor.
 */

try {
  ensureLocalConfig();
} catch (error) {
  // Configuração inválida: para aqui, com a lista do que corrigir (sem mostrar valores).
  if (error instanceof ConfigError) {
    process.stderr.write(`\n${error.message}\n\nConfira o .env.local (modelo em .env.example).\n\n`);
    process.exit(1);
  }
  throw error;
}
loadStore();

// Mídia órfã (fotos que nenhum perfume usa) sai na partida e a cada 6 h.
const sweep = async () => {
  try {
    const { removed, bytes } = await collectMediaGarbage(store.referenced());
    if (removed) event('media.gc', { removed, kb: Math.round(bytes / 1024) });
  } catch (error) {
    log.warn({ event: 'media.gc', err: error });
  }
};
void sweep();
setInterval(() => void sweep(), 6 * 60 * 60 * 1000).unref();

const handle = createHandler();
const server = http.createServer((req, res) => void handle(req, res));
server.requestTimeout = 2 * 60_000;

server.on('error', (error: NodeJS.ErrnoException) => {
  log.fatal({ event: 'server.error', code: error.code, port: config.port, err: error });
  process.stderr.write(
    error.code === 'EADDRINUSE'
      ? `\nA porta ${config.port} já está em uso. Feche a outra janela ou defina PERFUMES_PORT com outra porta.\n\n`
      : `\nNão consegui iniciar: ${error.message}\n\n`,
  );
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const lan = config.host === '0.0.0.0' ? localAddresses() : [];
  // Só o que está configurado — nenhum valor secreto.
  event('server.started', { ...describeConfig(), lanAddresses: lan.length });
  // O quadro para gente só aparece num terminal: o código de acesso é segredo e não pode ir para o arquivo de log
  // (o atalho da Área de Trabalho grava a saída em data/logs/server.log). O código continua no .env.local.
  if (!process.stdout.isTTY) return;
  process.stdout.write(
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
      '',
    ].join('\n'),
  );
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
