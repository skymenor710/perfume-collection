import http from 'node:http';
import { config, ConfigError, describeConfig, ensureLocalConfig } from './config';
import { redactDbError } from './db/client';
import { createHandler } from './http/app';
import { localAddresses } from './http/guard';
import { event, log } from './log';
import { collectMediaGarbage } from './media/gc';
import { backupLibraryFromDb, openLibraryRepository, StartupError } from './repositories';

/**
 * Coleção de perfumes no computador: serve o app e faz o que o navegador sozinho não consegue —
 * abrir a página de uma loja, baixar a foto do frasco, recortar o fundo e achar a cor.
 */

const fail = (message: string): never => {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
};

try {
  ensureLocalConfig();
} catch (error) {
  // Configuração inválida: para aqui, com a lista do que corrigir (sem mostrar valores).
  if (error instanceof ConfigError) fail(`${error.message}\n\nConfira o .env.local (modelo em .env.example).`);
  throw error;
}

let opened: Awaited<ReturnType<typeof openLibraryRepository>>;
try {
  opened = await openLibraryRepository();
} catch (error) {
  const message = error instanceof StartupError ? error.message : redactDbError(error, config.databaseUrl);
  log.fatal({ event: 'server.error', stage: 'library', message });
  fail(`Não consegui abrir a coleção (${config.storageBackend}): ${message}`);
}
const { repo } = opened!;

// Mídia órfã (fotos que nenhum perfume usa) sai na partida e a cada 6 h.
const sweep = async () => {
  try {
    const { removed, bytes } = await collectMediaGarbage(await repo.referenced());
    if (removed) event('media.gc', { removed, kb: Math.round(bytes / 1024) });
  } catch (error) {
    log.warn({ event: 'media.gc', err: redactDbError(error, config.databaseUrl) });
  }
};
void sweep();
setInterval(() => void sweep(), 6 * 60 * 60 * 1000).unref();

// Postgres: cópia no formato do library.json na partida e a cada 24 h (caminho de volta para o JSON).
if (opened!.db) {
  const db = opened!.db;
  const backup = async () => {
    try {
      event('library.backup', { file: (await backupLibraryFromDb(db)).split(/[\\/]/).slice(-3).join('/') });
    } catch (error) {
      log.warn({ event: 'library.backup', err: redactDbError(error, config.databaseUrl) });
    }
  };
  void backup();
  setInterval(() => void backup(), 24 * 60 * 60 * 1000).unref();
}

const handle = createHandler({ repo });
const server = http.createServer((req, res) => void handle(req, res));
server.requestTimeout = 2 * 60_000;

server.on('error', (error: NodeJS.ErrnoException) => {
  log.fatal({ event: 'server.error', code: error.code, port: config.port, err: error });
  fail(error.code === 'EADDRINUSE' ? `A porta ${config.port} já está em uso. Feche a outra janela ou defina PERFUMES_PORT com outra porta.` : `Não consegui iniciar: ${error.message}`);
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

const shutdown = () => {
  server.close();
  void opened!.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
