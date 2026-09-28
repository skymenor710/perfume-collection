# Arquitetura — Meus Perfumes

> Estado em **27/09/2026**, depois das FASES 0 e 1 da preparação para produção.
> Plano de produção: [PRODUCTION.md](PRODUCTION.md) · Decisões: [ADR/](ADR/) · Auditoria original (antes da reorganização):
> [history/2026-09-27-auditoria-arquitetura.md](history/2026-09-27-auditoria-arquitetura.md).

O app roda **inteiro neste computador** (servidor Node na porta 3100, atalho "Meus Perfumes"). A reorganização trocou
peças por dentro — pastas, API versionada, jobs, fontes, segurança, configuração, logs, interfaces de persistência —
**sem mudar o que a pessoa vê**: o build do web saiu byte a byte igual ao anterior, e a coleção (15 perfumes, Reflection
50 ml, 32 imagens) confere com o baseline por SHA-256.

---

## 1. Estrutura

```
perfume-collection/
├─ apps/
│  ├─ web/                 @perfumes/web — Vite + React 19 (a interface; nada mudou nela)
│  │  ├─ src/              app.tsx, components/, gl/ (galáxia), design/accent.ts (animação da cor), data/, lib/, styles/
│  │  ├─ public/           bottles/, icons/, manifest.webmanifest, sw.js
│  │  └─ index.html, vite.config.ts   (build em apps/web/dist; variante claude.ai em dist-artifact/)
│  └─ server/              @perfumes/server — Node (tsx)
│     └─ src/
│        ├─ main.ts        partida: config → biblioteca → limpeza de mídia → HTTP
│        ├─ config.ts      ambiente validado (zod)
│        ├─ log.ts         logs estruturados (pino) com redação
│        ├─ store.ts       biblioteca em data/library.json (implementa LibraryRepository)
│        ├─ http/          app.ts (rotas atuais + montagem da v1), v1.ts (Hono), guard.ts, seo.ts, paths.ts
│        ├─ jobs/          importação como job: types, memory-store, runner, slots
│        ├─ sources/       registro de fontes + disjuntor
│        ├─ repositories/  porta LibraryRepository
│        ├─ storage/       porta StorageProvider + LocalStorageProvider
│        ├─ db/            schema.ts — Postgres preliminar (Drizzle), sem conexão
│        ├─ net/           safe-fetch, address (SSRF), egress (teto global), sniff (tipo real da imagem), polite (robots/ritmo)
│        ├─ import/        pipeline (link → perfume), variants, extract
│        ├─ resolver/      resolvedor "produto primeiro", busca, leitura de URL
│        ├─ research/      Parfumo, lojas oficiais, Fragrantica, escolha de foto, cache
│        └─ media/         recorte (IA + cor), worker, gravação, limpeza
├─ packages/
│  └─ core/                @perfumes/core — domínio puro: perfume, biblioteca, cor, accent, notas, recorte, qualidade, correspondência
├─ scripts/                launch.ps1 (atalho), smoke, verify-state, build-artifact, laboratório
├─ tests/                  vitest (329 testes)
├─ docs/                   ARCHITECTURE, PRODUCTION, ADR/, state/ (baseline), history/
└─ data/                   (fora do Git) library.json, media/, cache/, models/, logs/
```

Regras de dependência (verificadas por teste e lint):

| Pacote | Pode importar | Não pode |
|---|---|---|
| `packages/core` | só arquivos do próprio pacote | DOM, `window`, `document`, `fetch`, React, three, `node:*`, `process` |
| `apps/web` | `@perfumes/core`, React, three | o servidor |
| `apps/server` | `@perfumes/core`, bibliotecas Node | a interface |

O core compila com `lib: ["ES2023"]` e `types: []` (o único global declarado é `URL`, que existe no navegador, no Node e
no React Native): usar DOM ali quebra o `typecheck`. É o que permite reaproveitá-lo no app nativo.

---

## 2. Caminho de uma requisição

```
HTTP ─► checkHost (Host deste PC / domínio público — contra DNS rebinding)
        │
        ├─ /api/* ─► checkSameOrigin (escrita só da mesma origem — contra CSRF)
        │            │
        │            ├─ /api/v1/* ─► Hono: cabeçalhos, limite de corpo 64 KB, /health público,
        │            │               Authorizer → Principal {userId}, rotas, erros como frase + código
        │            │
        │            └─ rotas atuais (inalteradas): /api/status, /api/pair, /api/public/…, /api/me,
        │               /api/perfumes[/:id][/refresh], /api/import, /api/perfumes/resolve (NDJSON),
        │               /api/photo, /api/events (SSE)
        │
        ├─ /media/*  ─► pública só se a foto estiver numa lista pública; senão exige acesso;
        │               lida pelo StorageProvider (chave validada + pasta conferida)
        └─ páginas   ─► index.html com metadados (Open Graph nas rotas /username…), arquivos do build via inside()
```

**Quem é quem (autorização).** Hoje há um usuário só. `Authorizer(req)` devolve `Principal { userId, via }` quando o
pedido vem deste computador (`loopback`) ou de um aparelho pareado pelo código (`device`); senão, `401`. Toda rota da v1
usa `principal.userId` — quando o Better Auth entrar (FASE 6), só a função muda ([ADR 0010](ADR/0010-autorizacao-por-principal.md)).

---

## 3. API v1

| Método e rota | Faz | Observações |
|---|---|---|
| `GET /api/v1/health` | `{ ok, api: "v1" }` | público; não fala da coleção |
| `GET /api/v1/me` · `PATCH /api/v1/me` | perfil do dono | mesma validação das rotas atuais |
| `GET /api/v1/perfumes` · `/perfumes/:id` | coleção inteira / um perfume | mesma visão `Perfume` das rotas atuais |
| `GET /api/v1/wishlist` · `/collection` | cada lista | partição exata de `/perfumes` |
| `POST /api/v1/imports` `{url, identity?, variantId?}` | cria job → `202` + `Location` | mesmo link em andamento → devolve o job existente (`deduplicated`) |
| `GET /api/v1/imports` · `/imports/:id` | lista / estado do job | job de outro dono = 404 |
| `GET /api/v1/imports/:id/events` | progresso ao vivo (SSE) | estado atual na hora; fecha quando termina |
| `DELETE /api/v1/imports/:id` | cancela | cooperativo: conferido a cada etapa |
| `POST /api/v1/imports/:id/retry` `{variantId?}` | nova tentativa | de `failed`, `cancelled` ou `waiting_choice` (escolha de versão) |
| `GET /api/v1/sources` | retrato das fontes e disjuntores | sem chaves |

Escrita da coleção (PUT/DELETE de perfume) continua nas rotas atuais — a interface não mudou e não precisa da v1 ainda.
Um job **só pesquisa**: quem grava o perfume é o cliente, como hoje.

---

## 4. Importação como job

```
POST /imports ─► ImportJobRunner.create ─► ImportJobStore (memória hoje; Postgres na FASE 2)
                     │
                     ▼ fila: researchSlots (2 vagas, divididas com as rotas antigas; elas recusam com 429, o job espera)
               queued ─► running ─► succeeded
                            │    ├─► waiting_choice (loja vende 50 ml e 100 ml: para e espera a escolha → retry {variantId})
                            │    ├─► failed (código + frase; erro técnico nunca vai cru)
                            └────┴─► cancelled (DELETE; o trabalho em andamento não sobrescreve o cancelamento)
```

- Progresso: etapa do resolvedor → percentual (`link 5 … notes 90 … done 100`).
- `importFromUrl(url, identity, onStage, variantId, { jobId, signal })` é o mesmo motor das rotas antigas; ganhou
  cancelamento cooperativo e os eventos de log `import.started / completed / failed / cancelled / choose_variant`.
- `MemoryImportJobStore` é **declaradamente não persistente** (`persistent = false`): reiniciar o servidor esquece os
  jobs, nunca a coleção. Limpeza: terminados somem em 1 h; teto de 500.

---

## 5. Fontes de dados

`sources/registry.ts` descreve o motor **atual** (nenhuma fonte nova, nenhum scraping novo):

| id | tipo | prioridade | timeout | cache | disjuntor |
|---|---|---|---|---|---|
| `product-page` | productPage | 1 | 15 s | — | não (cada link é um site) |
| `parfumo` | catalog | 2 | 15 s | 7 d | 5 falhas → 30 min; verificação → 30 min |
| `official-stores` | officialStore | 3 | 15 s | 1 d | não (vários sites) |
| `fragrantica` | perfumeDatabase | 4 | 15 s | 30 d | verificação anti-robô → 6 h |
| `brave` | searchAPI | 5 | 10 s | 7 d | 3 falhas → 15 min; só com chave |
| `duckduckgo` | searchAPI | 6 | 12 s | 7 d | verificação → 30 min |
| `resellers` | reseller | 7 | 15 s | — | não |

Cada fonte: prioridade, timeout, ritmo (1,5 s por site em `polite.ts`; DuckDuckGo +3,5 s), validade de cache, qualidade
(0–1), ligada/desligada (`SOURCES_DISABLED`) e disjuntor (fechado → aberto → meia-abertura com um pedido de teste).
As pausas do DuckDuckGo e da Fragrantica, que eram variáveis soltas, agora são o disjuntor dessas fontes.
O disjuntor é por processo (memória); na FASE 4 vai para o Postgres para valer entre instâncias.

---

## 6. Segurança

| Camada | Onde | O quê |
|---|---|---|
| Host | `guard.checkHost` | só os nomes deste PC (e o domínio público, se configurado) na porta do app |
| Mesma origem | `guard.checkSameOrigin` | escrita só com `Origin` igual ou `Sec-Fetch-Site: same-origin` |
| Acesso | `guard.isAuthorized` / `Authorizer` | este PC ou aparelho pareado (cookie HttpOnly, SameSite=Strict; 6 tentativas/15 min) |
| Público | `store.publicProfile/publicList` | tudo privado por padrão; privado e inexistente respondem igual (404); visão pública sem campos pessoais |
| SSRF | `net/address`, `net/safe-fetch` | http/https, sem credenciais, **só portas 80/443**, IP interno recusado no link, **na conexão (DNS vigiado)** e **em cada redirecionamento**; IPv6 expandido antes de comparar: loopback, mapeado, compatível, NAT64, **6to4**, **Teredo**, ULA, link-local, multicast, documentação |
| Teto de saída | `net/egress` | todas as fontes somadas: 6 conexões simultâneas e 120 pedidos/min (configurável); quem passa espera a vez |
| Imagens | `net/sniff` | **SVG recusado sempre**; tipo conferido **pelos bytes** (PNG, JPEG, WebP, GIF, AVIF), no download e no envio de foto |
| Modelo de IA | `media/matting` | URL fixada no commit do repositório; **SHA-256 conferido** antes de carregar; download só por https e para `.part`; não bate → não carrega (recorte por cor segue) |
| Arquivos | `http/paths.inside`, `storage/local` | caminho resolvido e conferido dentro da pasta; chave de armazenamento sem `..`, barra inicial ou caractere estranho |
| Corpo | `readBody`, `bodyLimit` | limites de tamanho enquanto chega |
| Página | CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` | inalterados |
| Segredos | `.gitignore`, `config.describeConfig`, `log.ts` | `.env*` fora do Git; log diz **quais** segredos existem, nunca o valor; redação de senha/token/cookie/autorização/chave; links sem query string; código de acesso fora do arquivo de log |

Testes específicos: `tests/security.test.ts` (116 casos), mais os de API (401, 403, 421, 413, travessia, SVG, lista
privada) em `tests/api-v1.test.ts`.

---

## 7. Configuração e logs

- `config.ts`: todas as variáveis passam por um schema zod. Valor inválido para a partida com a lista do que corrigir
  (sem repetir valores). `.env.example` documenta tudo, sem valores; o `.env.local` deste PC continua sendo lido.
  As variáveis de produção (`DATABASE_URL`, `R2_*`, `AUTH_SECRET`, `EMAIL_PROVIDER_KEY`, `SENTRY_DSN`) já são
  validadas, mas **não usadas** nesta etapa.
- `log.ts`: pino, uma linha JSON por evento, com `event` de uma lista fechada (`server.started`, `import.*`,
  `source.used/error/paused`, `search.completed`, `image.error`, `model.*`, `media.gc`, `library.*`, `egress.throttled`).
  O quadro com o endereço e o código de acesso só aparece num terminal interativo.

---

## 8. Persistência — portas e implementações (FASE 2)

| Porta | Implementações | Escolha |
|---|---|---|
| `LibraryRepository` (assíncrono) | `store` → `data/library.json` · `PostgresLibraryRepository` → Postgres (Neon; PGlite no ensaio/testes) | `STORAGE_BACKEND` em `repositories/index.ts` |
| `StorageProvider` | `LocalStorageProvider` → `data/media` | R2 na FASE 3 |
| `ImportJobStore` | `MemoryImportJobStore` (não persistente) | tabela `import_jobs` + pg-boss na FASE 4 |

- Regras comuns (visões, perfil, atualização pela planilha) em `repositories/rules.ts` + core: os dois backends não
  podem divergir. Linhas ⇄ domínio só em `db/mapping.ts`; driver só em `db/client.ts`.
- Schema e decisões: [ADR 0011](ADR/0011-migracao-json-postgres.md). Migrations em `apps/server/drizzle/`
  (`npm run db:generate` gera, `db:migrate` aplica; nunca `push`).
- `db:import` (valida → transação → verifica → COMMIT, idempotente), `db:verify` (JSON × Postgres, baseline, API byte a
  byte), `db:export` (volta para o formato do library.json). Roteiro: [state/fase2-20260927](state/fase2-20260927/README.md).
- Operação do dia a dia, backup externo recomendado, TLS e rollback explícito: [OPERATIONS.md](OPERATIONS.md).
- Com postgres, a partida exige migrations em dia e nunca cai para o JSON em silêncio; cópia no formato do library.json
  na partida e a cada 24 h em `data/backups/postgres/`.

## 9. Domínio (packages/core)

`Library` (schema 2) = `users` + `products` (catálogo: identidade, versões, imagens, aparência, pirâmide) + `entries`
(relação pessoal: lista, versão escolhida, posição, veredito, observação, links, preço visto). A API entrega a visão
achatada `Perfume` (`toPerfumeView` / `fromPerfume` / `applyPerfumeView`, ida e volta sem perda — testado).
`accentFor`/`SILVER` (regra da cor do frasco) passaram do web para o core: o servidor usa a mesma regra; o
`AccentController` (animação no DOM) ficou no web.

---

## 10. Verificação

| Comando | O quê |
|---|---|
| `npm run check` | typecheck (core, web, server, scripts/testes) + lint + 329 testes (inclusive contra Postgres via PGlite) + build — o mesmo do CI |
| `npm run smoke` · `npm run smoke -- --backend=postgres` | servidor com dados temporários + Edge headless: 56 verificações (JSON ou Postgres), incluindo importação real pelo link |
| `npm run build:artifact && npm run smoke:artifact` | variante do link do claude.ai |
| `npm run state:verify` | coleção real × `docs/state/baseline.json` (campos + SHA-256 de cada foto) |

CI (`.github/workflows/ci.yml`): `npm ci`, typecheck, lint, test, build. Sem segredos, sem deploy. (Não há remoto
configurado; nada foi enviado.)

---

## 11. O que foi preservado de propósito

Galáxia, cores, tipografia, `Bottle`, animações, layout, cards, pirâmide olfativa, 3D, microcópia, PWA, rotas antigas
e seus formatos, NDJSON de importação, SSE de sincronização, código de acesso do celular, lançador do Windows,
variante do claude.ai, `data/` inteiro.
