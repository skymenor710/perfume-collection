# ADR 0005 — Importação como job (criar → acompanhar → resultado)

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

A importação levava 30–60 s presa a uma resposta NDJSON aberta; no celular, a conexão cai. Produção pede
tarefa em segundo plano (pg-boss na FASE 4).

## Decisão

- `ImportJob` com estados `queued | running | waiting_choice | succeeded | failed | cancelled`, progresso por etapa,
  erro com código e frase, tentativas.
- `ImportJobStore` (contrato) + `MemoryImportJobStore` (**não persistente**, declarado em `persistent = false`).
- `ImportJobRunner`: fila nas mesmas 2 vagas das rotas antigas, cancelamento cooperativo (sinal conferido a cada etapa),
  retry (inclusive para responder "qual versão?"), dedupe do mesmo link em andamento, gravações em ordem por job.
- Rota NDJSON antiga preservada.

## Consequências

- Reiniciar o servidor esquece jobs (nunca a coleção: um job só pesquisa).
- FASE 4: tabela `import_jobs` + pg-boss implementam o mesmo contrato; SSE retoma do estado gravado.

## Alternativas consideradas

Redis/BullMQ (serviço extra); converter a rota antiga (mudaria o comportamento da interface).
