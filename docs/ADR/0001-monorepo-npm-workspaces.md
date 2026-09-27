# ADR 0001 — Monorepo com npm workspaces: apps/web, apps/server, packages/core

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

O código vivia em `src/` (interface + domínio) e `server/`, com o servidor importando `../src/core` e até
`../src/design/accent`. Para produção e para o app nativo futuro, o domínio precisa ser um pacote independente de
plataforma, e web e servidor precisam de fronteiras claras.

## Decisão

- npm workspaces (sem ferramenta extra): `@perfumes/core`, `@perfumes/web`, `@perfumes/server`.
- `@perfumes/core` exporta os fontes TypeScript direto (`exports: { "./*": "./src/*.ts" }`) — Vite, tsx e vitest
  consomem sem etapa de build.
- O core compila com `lib: ["ES2023"]` e `types: []`; o único global declarado é `URL`. Lint proíbe `window`,
  `document`, `fetch`, React, three e `node:*` ali; um teste confere os imports.
- A parte pura de `accent.ts` (`accentFor`, `SILVER`) foi para o core; o `AccentController` (DOM) ficou no web.
- Servidor acha a raiz do repositório pelo próprio arquivo (não pelo `cwd`).

## Consequências

- Build do web saiu byte a byte igual ao anterior (mesmos hashes) — prova de que a interface não mudou.
- `typecheck` roda 4 projetos (core, web, server, scripts/testes).
- Para produção, o servidor precisará de build (esbuild) em vez de `tsx` (FASE 5).

## Alternativas consideradas

pnpm/Turborepo/Nx (ferramenta a mais sem ganho neste tamanho); manter pastas soltas (core continuaria acoplado).
