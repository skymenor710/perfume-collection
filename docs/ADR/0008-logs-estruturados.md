# ADR 0008 — Logs estruturados (pino) com redação

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

`console.log` com texto livre; o quadro de partida (com o código de acesso) ia para `data/logs/server.log`.

## Decisão

- pino, JSON por linha, `event` de uma lista fechada (`import.*`, `source.*`, `search.completed`, `image.error`,
  `model.*`, `media.gc`, `library.*`, `server.*`, `egress.throttled`).
- Redação de `password`, `token`, `cookie`, `authorization`, `accessCode`, `secret`, `apiKey` e cabeçalhos sensíveis;
  links reduzidos a origem + caminho (`safeUrl`), rotas sem query (`safePath`).
- Quadro humano (com o código) só em terminal interativo.

## Consequências

- Pronto para os logs do Railway/Sentry; `jobId` correlaciona uma importação de ponta a ponta.

## Alternativas consideradas

winston (mais lento, mais configuração).
