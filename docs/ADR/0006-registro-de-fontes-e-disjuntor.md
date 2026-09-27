# ADR 0006 — Registro de fontes com disjuntor

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

As fontes (página do link, Parfumo, lojas oficiais, Fragrantica, Brave, DuckDuckGo, revendedores) tinham tempos,
ritmos e pausas espalhados (`ddgPausedUntil`, `pausedUntil`).

## Decisão

- `SourceDescriptor`: tipo (`catalog`, `productPage`, `officialStore`, `perfumeDatabase`, `searchAPI`, `reseller`),
  prioridade, timeout, ritmo, validade de cache, qualidade, ligada/desligada (`SOURCES_DISABLED`), requisitos, disjuntor.
- `CircuitBreaker`: limite de falhas → aberto por um tempo → meia-abertura com um pedido de teste; pausa explícita
  (`trip`) quando o site pede verificação. Pausas antigas migradas para ele (mesmos tempos; Parfumo agora também pausa
  30 min se pedir verificação, em vez de insistir).
- **Nenhuma fonte ou scraping novo.** Eventos `source.used / error / paused`.

## Consequências

- Estado por processo; FASE 4 grava disjuntores no Postgres para valer entre instâncias.

## Alternativas consideradas

Biblioteca de resiliência (opossum etc.): dependência para ~80 linhas.
