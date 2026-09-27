# ADR 0009 — Configuração só pelo ambiente, validada por zod

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

Leituras de `process.env` espalhadas (porta, chave da Brave, depuração).

## Decisão

- `config.ts` valida tudo num schema; `VAR=` vazio = não definido; valor inválido para a partida com a lista do que
  corrigir, sem repetir valores.
- `.env.example` com todas as variáveis (inclusive as de produção, validadas e ainda não usadas), sem valores.
- `describeConfig` informa quais segredos existem, nunca o conteúdo.
- `SEARCH_PROVIDER_KEY` substitui `BRAVE_SEARCH_API_KEY` (o nome antigo continua aceito).

## Consequências

- Produção configura só por variáveis do Railway.

## Alternativas consideradas

dotenv + leituras soltas (sem validação).
