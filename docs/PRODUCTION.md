# Meus Perfumes — Produção

> Infraestrutura de produção **aprovada** (27/09/2026) e o andamento de cada fase. Nada aqui está no ar ainda:
> nenhum deploy, nenhuma conta externa, nenhum banco, nenhum upload. A arquitetura atual (o que já existe no código)
> está em [ARCHITECTURE.md](ARCHITECTURE.md); as decisões, em [ADR/](ADR/).

## Andamento

| Fase | O quê | Status |
|---|---|---|
| 0 · Git + backup + CI | Repositório local, `.gitignore` sem dados/segredos, `.env.example`, lint, CI sem credenciais, baseline da coleção | ✅ feito — **sem remoto** (push só com autorização) |
| 1 · Reorganização local | Monorepo, Hono `/api/v1`, jobs, fontes, repositório/storage, config, logs, correções de segurança da §14 | ✅ feito |
| 2 · Banco | Neon (branch de dev) + Drizzle + migração do `library.json` verificada | 🔶 pronto e ensaiado localmente (Postgres/PGlite: 0 diferenças, API byte a byte, smoke 56/56); **falta o Neon** — conta e `DATABASE_URL` do dono |
| 3 · Storage | R2 + chaves pelo conteúdo + migração das imagens verificada | ⏳ 3.0 feita (implementação local testada, ver [R2.md](R2.md)); falta 3.1 (R2 real) e 3.2 (virada) |
| 4 · Tarefas | pg-boss: importação como tarefa, cache e disjuntores no banco | ⏳ contrato `ImportJobStore` e runner prontos (em memória) |
| 5 · Deploy privado | Dockerfile, Railway (web + worker), domínio, Cloudflare, HTTPS, Sentry | — |
| 6 · Contas | Better Auth + código por e-mail | ⏳ ponto de entrada `Authorizer` pronto |
| 7–12 | Perfil, compartilhamento, PWA mobile, presentes, preparação nativa, app nativo | — |

### Correções de segurança da §14 já aplicadas (FASE 1)

- Saída só nas portas 80/443, inclusive em redirecionamentos.
- IPv6: 6to4 (`2002::/16`), Teredo (`2001::/32`), NAT64, IPv4 mapeado/compatível, ULA, link-local, multicast bloqueados
  (endereço expandido antes de comparar).
- SVG recusado; tipo de imagem conferido pelos bytes (download e envio).
- Teto global de saída (`EGRESS_MAX_CONCURRENT`, `EGRESS_MAX_PER_MINUTE`).
- Modelo de IA: URL fixada no commit `de15b22b…` e SHA-256 `56000243…3333` conferido antes de carregar.
- Mantidas: SSRF em todo redirecionamento, travessia de pasta, CSRF (mesma origem), validação de Host.

### Variáveis de ambiente

Todas em [`.env.example`](../.env.example) (sem valores). Em produção vivem nas variáveis do Railway — nunca no
repositório. Validadas na partida por `apps/server/src/config.ts`.

| Grupo | Variáveis | Usadas hoje? |
|---|---|---|
| Servidor local | `PERFUMES_PORT`, `PERFUMES_HOST`, `PERFUMES_DATA_DIR`, `PERFUMES_MODELS_DIR`, `PERFUMES_ACCESS_CODE`, `PERFUMES_USERNAME`, `PERFUMES_DISPLAY_NAME`, `PERFUMES_PUBLIC_ORIGIN`, `LOG_LEVEL` | sim |
| Rede e fontes | `EGRESS_MAX_CONCURRENT`, `EGRESS_MAX_PER_MINUTE`, `SEARCH_PROVIDER_KEY` (ou `BRAVE_SEARCH_API_KEY`), `SOURCES_DISABLED` | sim |
| Banco | `STORAGE_BACKEND`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `TEST_DATABASE_URL`, `NEON_TEST_DATABASE_NAME` | sim (Postgres oficial desde 28/09) |
| Fotos (FASE 3) | `MEDIA_BACKEND`, `MEDIA_FALLBACK`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL` | validadas; `MEDIA_BACKEND=local`; R2 ainda sem credenciais |
| Produção | `AUTH_SECRET`, `EMAIL_PROVIDER_KEY`, `SENTRY_DSN` | validadas, **não usadas** |

### Antes do primeiro deploy (checklist)

- [ ] Dono decide: domínio; contas em GitHub, Railway, Neon, Cloudflare, Resend (criadas por ele); destino do link do claude.ai.
- [ ] Repositório remoto privado (push autorizado pelo dono).
- [ ] FASE 2: migração `library.json` → Postgres com comparação de ida e volta (`npm run state:verify` + `docs/state/api-baseline.json`).
- [ ] FASE 3: fotos para o R2 com SHA-256 conferido, referências trocadas em uma transação.
- [ ] Dockerfile com o modelo embutido (hash conferido no build) e TypeScript compilado (sem `tsx` em produção).
- [ ] Sentry, monitor de disponibilidade em `/api/v1/health`, backups (`pg_dump` diário) e ensaio de restauração.

---

# Proposta aprovada

## 0. Contexto do projeto

App pessoal (que deve virar produto) para organizar perfumes: a pessoa **cola só o link** de um perfume e o sistema
identifica o produto, pesquisa outras fontes, encontra e recorta a melhor foto do frasco (PNG transparente), acha a
pirâmide olfativa, o preço e as versões (50 ml × 100 ml) e adiciona à **Wishlist**; depois o perfume pode ir para a
**Coleção** com um veredito. Interface imersiva: fundo de galáxia (WebGL), frascos num palco 3D, cor do frasco tingindo
a galáxia. Futuro: contas, perfis públicos (`/username`, `/username/wishlist`, `/username/collection`),
compartilhamento com prévias bonitas, sistema de presentes (reservar sem revelar quem), PWA e apps iOS/Android.

**Estado atual (funciona localmente):**
- Front: React 19 + TypeScript + Vite, CSS próprio, galáxia WebGL2 feita à mão, palco 3D em CSS.
- Back: servidor Node próprio (HTTP puro, roteamento manual), API JSON, progresso por NDJSON, sincronização por SSE.
- Dados: arquivo `library.json` com modelo já separado em **Usuário / Produto (com versões e imagens) / Entrada**
  (wishlist/coleção, versão escolhida, posição, veredito, observação, link, preço visto). A API entrega uma "visão"
  achatada para a interface.
- Imagens: arquivos locais (PNG mestre 2048² transparente + WebP 1024/384).
- Pesquisa no servidor: resolvedor "produto primeiro" (o link é só uma pista): página do link (JSON-LD, JSON da
  Shopify, WooCommerce), leitura do endereço, catálogo da base Parfumo, lojas oficiais Shopify, busca (DuckDuckGo HTML
  sem chave; Brave API opcional), detecção de versões e pergunta ao usuário.
- Recorte de fundo por IA local (BiRefNet-lite ONNX, 224 MB, via onnxruntime-node) + sharp, num worker thread, com
  controle de qualidade (apoio de borda, névoa, buracos, variante errada) e troca de fonte quando reprova.
- Segurança existente: fetch contra SSRF (IP validado na conexão, a cada redirecionamento), validação de Host,
  checagem de origem (CSRF), cookie HttpOnly/SameSite=Strict, sanitização de tudo que entra, CSP.
- Acesso: sem contas — código de acesso por aparelho (dono único implícito).
- URLs públicas já preparadas (só leitura, metadados Open Graph gerados no servidor, tudo privado por padrão).
- PWA básico: manifest, ícones, service worker (cache do app e fotos, leitura offline da última coleção).
- Testes: unitários (vitest) + smoke de ponta a ponta (Playwright com Edge/Chrome).

**Objetivo:** colocar na internet como produto real (web, PWA, iPhone, Android, depois app nativo), com contas,
múltiplos usuários, compartilhamento e presentes — tudo na mesma infraestrutura e nos mesmos dados.

---

## 1. Análise do stack atual

| Parte | Decisão | Motivo |
|---|---|---|
| React 19 + Vite + TS, CSS, galáxia WebGL | **Continua** | Independe de onde roda |
| Domínio compartilhado (hoje `packages/core`: modelo, cor, recorte, correspondência, variantes, biblioteca) | **Continua; já virou pacote compartilhado** | Sem DOM, reaproveitável no nativo |
| Motor de pesquisa (`apps/server/src/resolver`, `research`, `import`, `media/process`, qualidade, fetch seguro, robots) | **Continua** (é o coração) | Só muda onde roda (tarefa em segundo plano) e onde guarda |
| Roteador HTTP manual (~400 linhas) | **Reorganiza** para Hono, rota a rota | Autenticação, middlewares e `/api/v1` ficam insustentáveis à mão |
| Armazenamento em `library.json` | **Substitui** por Postgres | Ver §2 |
| Imagens em disco local + cache em arquivos | **Substitui** por R2 + tabela de cache no Postgres | Disco de container é descartável |
| Código de acesso por aparelho | **Substitui** por contas | Validação de Host e checagem de origem ficam |
| DuckDuckGo HTML como buscador | **Sai em produção** | Não é uso legítimo a partir de servidor e bloqueia rápido |
| Importação por fluxo NDJSON preso à requisição (30–60 s) | **Vira tarefa em segundo plano** | Celular derruba conexões longas |

**Decisões atuais que quebram em produção** (supõem uma máquina e um processo): vagas de pesquisa, pausas de fontes
(disjuntores) e limites de acesso guardados **na memória**; modelo de IA de 224 MB **baixado na partida** e verificado
só pelo tamanho; `tsx` rodando TypeScript direto em produção; atualização de dados a partir de arquivo local; escritas
em disco local.

---

## 2. Banco de dados

| Opção | Concorrência | Backup / recuperação | Node/TS | Crescimento | Veredito |
|---|---|---|---|---|---|
| `library.json` | 1 escritor, regrava tudo | Copiar arquivo | — | Nenhum | ❌ sem transação (presentes), sem várias instâncias |
| SQLite + Litestream | 1 escritor, rápido | Réplica contínua | Ótimo | Até 1 máquina | ❌ prende estado a um disco e a uma instância |
| Turso (SQLite gerenciado) | Bom | Gerenciado | Bom | Bom | ❌ menos ferramentas; sem vantagem aqui |
| Supabase (Postgres+Auth+Storage) | Postgres | Diário no pago | Bom | Bom | ❌ regras de acesso duplicadas (servidor + RLS); projeto gratuito pausa quando parado |
| Firebase/Firestore | Bom | Gerenciado | Bom | Bom | ❌ não relacional; produto → versão → entrada → reserva vira remendo |
| Postgres do próprio Railway | Postgres | Snapshot de volume | Ótimo | Bom | ❌ backup/restauração menos maduros |
| **Neon (Postgres serverless)** | Postgres + pooler | **Restauração pontual (PITR)**, branches para testes | Ótimo com **Drizzle** | Escala computação sozinho | ✅ **escolhido** |

**Recomendação: Neon Postgres (região Frankfurt) + Drizzle ORM + migrações `drizzle-kit` versionadas no repositório.**
Transações (reserva de presente sem duplicata; importação atômica); branches para testar migração antes de aplicar;
camada gratuita cobre a fase pessoal; Postgres padrão (sair é um `pg_dump`); o app nativo consome pela API, nunca
direto no banco.

**Tabelas previstas:** `users`, `sessions`, `accounts` (auth), `products`, `product_variants`, `product_images`,
`entries` (wishlist/coleção), `reservations` (presentes), `import_jobs`, `source_cache`, `sources` (fontes e limites),
`push_subscriptions` (futuro).

---

## 3. Storage de imagens

| Opção | Veredito |
|---|---|
| **Cloudflare R2** | ✅ **escolhido** — API S3 (SDK da AWS), **sem cobrança de saída**, domínio próprio com cache do Cloudflare, URLs assinadas para privados, regras de ciclo de vida |
| Amazon S3 | ❌ cobra saída por imagem vista; exigiria CloudFront |
| Supabase Storage | ❌ só faria sentido com o Supabase inteiro |
| Volume do Railway | ❌ não é object storage, sem CDN, amarrado à instância |

**Desenho:**
- `img.dominio.com` → R2, cache imutável de 1 ano.
- **Chaves pelo conteúdo** (ex.: `p/<sha256>/1024.webp`, `384.webp`, `master.png`, `.avif` quando ligar): trocar foto
  = chave nova + banco aponta para ela (o CDN nunca serve versão velha); a mesma foto usada por mil usuários existe uma vez.
- PNG mestre em prefixo **privado**; entrega pública só WebP/AVIF.
- Tabela `product_images`: versão do produto, papel (principal/alternativa), dimensões, transparência, nota de
  qualidade, fonte, confiança, pHash.
- Remoção → prefixo `trash/` que expira em 30 dias (regra de ciclo de vida) = chance de recuperação.

---

## 4. Backend

**Escolha: reorganizar parcialmente, preservando os módulos.**

| Opção | Veredito |
|---|---|
| A) Hospedar como está | ❌ disco local, estado em memória, sem contas |
| **B) Reorganizar** | ✅ Hono no lugar do roteador; `/api/v1`; interfaces de repositório (Postgres) e storage (R2); tarefas via pg-boss; mesmo código de pesquisa |
| C) API totalmente separada do front | ❌ domínio único + cookie de mesma origem é mais simples e seguro (sem CORS) |
| D) Serverless | ❌ onnxruntime + sharp + modelo de 224 MB + tarefas de até 1 min estouram limites de funções |

**Um código (monorepo leve), dois processos do mesmo repositório:**
- `web` — API, HTML com prévias das páginas públicas, autenticação, arquivos do front.
- `worker` — pesquisa, recorte, geração de prévias, limpeza (tarefas do pg-boss).
Na fase pessoal podem ser um único serviço (variável liga o worker dentro dele).

---

## 5. Hosting

| Opção | React/Vite | Node contínuo | Imagens (sharp+IA) | Worker/cron | Administração | Veredito |
|---|---|---|---|---|---|---|
| Vercel | Ótimo | Funções | ❌ limites de tamanho/tempo | Limitado | Fácil | ❌ |
| Netlify | Ótimo | Funções | ❌ | Limitado | Fácil | ❌ |
| Cloudflare Workers/Pages | Ótimo | Workers | ❌ sem módulos nativos (sharp, onnxruntime) | Sim | Fácil | ❌ para o back (Cloudflare fica como DNS/CDN/R2) |
| Render | Sim | Sim | Sim | Sim | Fácil | 2º lugar — preço fixo por instância encarece 2 GB |
| Fly.io | Sim | Sim | Sim | Sim | Mais CLI | 3º lugar — ótimo, mais conceitos para administrar |
| VPS (Hetzner) | Sim | Sim | Sim | Montar à mão | Você cuida de SO, patches, backups | ❌ para quem quer pouca administração |
| **Railway** | Sim | Sim | Sim (Docker) | **Serviços de worker e cron nativos** | **Painel simples, deploy pelo GitHub, variáveis e logs na interface** | ✅ **escolhido** |

**Recomendação: Railway (região EU West), deploy por Dockerfile a partir do GitHub.** A imagem Docker leva o
**modelo de IA embutido com SHA-256 conferido** (a partida não baixa nada); TypeScript compilado (esbuild) em vez de
`tsx`; cobrança por uso real favorece um app pessoal que passa a maior parte do tempo parado.

---

## 6. Autenticação

| Método | Web | iPhone (PWA) | Android | Veredito (1ª versão) |
|---|---|---|---|---|
| E-mail + senha | ✓ | ✓ | ✓ | ❌ senhas fracas, recuperação, vazamento: mais risco sem ganho |
| Magic link | ✓ | ⚠️ o link abre no Safari, **fora do PWA instalado** — o login se perde | ✓ | ❌ |
| **Código por e-mail (6 dígitos)** | ✓ | ✓ digita dentro do app | ✓ | ✅ **escolhido** |
| Google | ✓ | ✓ | ✓ | Depois, se fizer falta |
| Apple | Exige conta de desenvolvedor paga | ✓ | — | Junto com o app nativo |

**Recomendação: Better Auth (biblioteca TypeScript no nosso servidor; contas no nosso Postgres) + código por e-mail
enviado pelo Resend.** Sessão persistente em cookie `HttpOnly`/`Secure`/`SameSite=Lax` de 60 dias com renovação (o que
mantém o PWA logado). Um método só na primeira versão: sem senha para vazar, sem depender de provedor social. Google e
passkeys são plugins do mesmo sistema; Apple entra com o app nativo (a App Store só exige quando há outro login social).
**Descartadas:** Clerk (custo por usuário, dependência), Supabase Auth (só com Supabase inteiro), Auth.js (fraco para nativo).

---

## 7. Domínio, DNS, HTTPS, CDN

- Registro e DNS: **Cloudflare** (registro a preço de custo; se já houver domínio, basta mover o DNS).
- `dominio.com` → Railway (CNAME na raiz resolvido pelo Cloudflare), atrás do proxy/CDN do Cloudflare.
- `www.dominio.com` → 301 para `dominio.com`. `img.dominio.com` → R2.
- `/username`, `/username/wishlist`, `/username/collection`: rotas do próprio app.
- API na **mesma origem** (`dominio.com/api/v1`), sem subdomínio `api.`: sem CORS, cookies simples; o nativo usa a
  mesma URL com token.
- HTTPS: certificado do Cloudflare na borda + do Railway na origem ("Full strict"); HSTS depois de estabilizar; HTTP → HTTPS.
- Cache no CDN: `/assets/*` e `img.*` imutáveis (1 ano); HTML, `/api/*` e páginas públicas **sem cache no CDN** no
  início (mudança de privacidade precisa valer na hora).
- E-mail: SPF, DKIM e DMARC para o Resend.

---

## 8. PWA

| Requisito | Como |
|---|---|
| Instalação | Manifest + HTTPS; convite no Android; instruções no iOS (não mostra convite) |
| Offline parcial | Service worker: app e fotos do cache, última coleção → IndexedDB |
| Atualização | Aviso "Nova versão · Atualizar" quando o service worker muda |
| Ícones e splash | Ícones prontos + telas de abertura do iOS por tamanho de aparelho |
| Safe area | Já existe (`env(safe-area-inset-*)`, `viewport-fit=cover`) |
| Push futuro | Web Push com VAPID (iOS 16.4+ só com o app instalado) + tabela `push_subscriptions` |
| Deep links | Rotas limpas + `apple-app-site-association` e `assetlinks.json` servidos pelo domínio |
| Login persistente | Cookie de sessão de 60 dias com renovação |
| Compartilhar para o app (Android) | Web Share Target: "Compartilhar → Meus Perfumes" direto da loja |

A arquitetura suporta tudo; o pré-requisito é HTTPS em domínio próprio.

---

## 9. App nativo sem reescrever

- Banco, autenticação, usuários, listas, compartilhamento e pesquisa ficam no servidor e são consumidos pela mesma
  `/api/v1` do web.
- Better Auth dá token para o app nativo (plugin Expo) — mesmas contas.
- Contrato da API descrito a partir dos schemas zod (OpenAPI) → cliente tipado gerado para web e nativo.
- `packages/core` (domínio, cores, correspondência, variantes) compartilhado.
- Tokens de design em JSON (mesma paleta, tipografia, movimentos).
- Reescrito (já isolado): galáxia (WebGL → Skia, mesmo shader) e palco (CSS 3D → Reanimated, mesma física de mola).
- Universal links: `/username/wishlist` abre o app quando instalado.

---

## 10. Pesquisa de perfumes em produção

```
POST /api/v1/imports {url}  →  cria import_job  →  responde {jobId} em milissegundos
                                   ↓ (pg-boss, worker)
  1 catálogo interno (produtos já resolvidos por qualquer usuário)       ← custo zero
  2 página do link (JSON-LD, JSON da Shopify, WooCommerce)       timeout 15 s, 1 retry
  3 leitura do endereço (slug, ASIN, EAN)                              local
  4 catálogo da base de perfumes (Parfumo…)                      cache 30 d
  5 lojas oficiais e revendedoras (tabela `sources`, editável)   cache 1 d
  6 Brave Search API (com chave) — só se 1–5 não resolverem      cache 7 d
  7 imagens → recorte → qualidade · notas · preço · versões
  → pergunta de versão (job pausa em "aguardando escolha") → resultado → usuário confirma
```

- Progresso por SSE; se a conexão cair, o cliente reconecta e retoma do estado gravado no job.
- Cada fonte é um provedor independente: timeout, 1 retry com espera crescente, **disjuntor gravado no banco** (fonte
  que falha pausa para todos), limite de ritmo **por domínio no banco**, robots.txt respeitado, identificação honesta
  (User-Agent do app, não disfarce de navegador).
- Falha de uma loja = "buscando em outras fontes", nunca erro.
- Mesmo link colado duas vezes durante a pesquisa reaproveita a tarefa em andamento.
- Cota por usuário (importações por hora; no máximo 2 simultâneas).
- Busca paga só no passo 6; o catálogo interno faz o custo **cair** conforme o produto cresce.
- Termos de uso: atribuição e link para a fonte em notas e fotos; processo de remoção sob pedido; nunca revender dados.
  (Risco jurídico cresce com o público: fotos de produto têm direito autoral; bases europeias têm proteção de banco de
  dados — avaliar com assessoria antes de abrir ao público.)

---

## 11. Processamento de imagens

- **No worker** (tarefa em segundo plano), com o motor atual (BiRefNet + sharp + controle de qualidade).
- Serviço externo (remove.bg, Photoroom, Cloudinary) descartado como principal: custo por imagem, perda do controle de
  qualidade, foto sai da nossa infraestrutura. Pode entrar como fallback plugável.
- Saídas: PNG mestre, WebP 1024/384 (AVIF opcional), dimensões, proporção, pHash, nota, fonte; **3 melhores
  alternativas guardadas** e ligadas à versão (50 ml e 100 ml podem ter frascos diferentes).
- Escala: worker em serviço separado com 2 GB; mais demanda = mais réplicas do worker; a fila distribui.

---

## 12. Tarefas em segundo plano

Necessárias. **Recomendação: pg-boss — fila dentro do Postgres que já teremos** (sem Redis nem serviço novo):
retries, agendamento, deduplicação, prioridade.

| Tarefa | Quando |
|---|---|
| `import.resolve` | Ao colar um link |
| `image.process` / `image.reprocess` | Na importação; em "pesquisar de novo" |
| `og.render` | Quando uma lista pública muda |
| `media.gc` | Diária (sem referência há 24 h → lixeira) |
| `catalog.refresh` | Semanal (preço e disponibilidade das versões) |
| `backup.dump` | Diária (cron do Railway) |

---

## 13. Cache

| Camada | O quê | Validade |
|---|---|---|
| Catálogo interno (Postgres) | Perfumes já resolvidos | Permanente, atualização semanal |
| `source_cache` (Postgres) | Respostas das fontes: busca, JSON de lojas, páginas da base, robots.txt | 7 d / 1 d / 30 d / 1 h |
| Cache negativo | Fonte bloqueada, produto inexistente | Curto (não repetir o erro) |
| R2 + CDN | Imagens | Imutáveis |
| CDN | `/assets/*` | Imutáveis |
| Service worker | App, fotos, última coleção | Até a próxima versão |
| Páginas públicas | Sem CDN no início | Ligar com purga ao mudar a privacidade |

---

## 14. Segurança

| Tema | Na arquitetura proposta |
|---|---|
| URL do usuário, SSRF, redirects, DNS rebinding | Fetch seguro atual (IP validado na conexão e a cada redirect; metadados de nuvem bloqueados) **+ só portas 80/443**, bloqueio de 6to4/Teredo, limites de tamanho e tempo; **roda só no worker**, nunca no processo web |
| Imagens remotas e uploads | Tipo checado pelos bytes; **SVG recusado**; limite de pixels do sharp; tudo recodificado; nomes pelo conteúdo |
| Autenticação e cookies | Sessões no Postgres; cookie `HttpOnly`/`Secure`/`SameSite=Lax`; códigos de uso único com expiração curta e limite de tentativas |
| Autorização | Todo acesso a entradas filtrado pelo dono no repositório, com testes de acesso a dado alheio (IDOR); público só lê listas públicas |
| CSRF / CORS | Mesma origem + checagem de Origin; CORS fechado; nativo com token Bearer |
| Rate limiting | Por usuário e por IP no Postgres + regras do Cloudflare na borda |
| Abuso de pesquisa | Cota por usuário, deduplicação, disjuntor global por fonte |
| Segredos | Variáveis do Railway (nunca no repositório); rotação; chaves separadas para desenvolvimento e produção |
| Dados privados | Tudo privado por padrão; "não existe" e "privado" respondem igual; PNG mestre privado |
| Cadeia de suprimentos | **SHA-256 do modelo de IA fixado**; `npm audit` + Dependabot no CI |
| LGPD | Exportar e apagar conta; política de privacidade |

---

## 15. Backups e recuperação

- Banco: restauração pontual do Neon (retenção conforme o plano) **+** `pg_dump` diário para bucket R2 separado
  (30 diários + 12 mensais).
- Imagens: chaves imutáveis + lixeira de 30 dias; PNG mestre permite regenerar todos os derivados.
- Configuração: código no Git; variáveis de ambiente documentadas com cópia num gerenciador de senhas.
- Desastre: restaurar dump num branch do Neon → apontar o serviço → conferir. **Ensaio de restauração trimestral.**
  Metas: perda máxima 24 h no pior caso (minutos com PITR), volta ao ar em menos de 1 h.

---

## 16. Observabilidade (mínimo profissional)

- **Sentry** (front e back): erros com contexto, inclusive de login.
- Logs estruturados JSON (pino) nos logs do Railway, com `jobId` e fonte em cada linha.
- Monitor de disponibilidade externo em `/healthz` (banco, fila, storage) com alerta por e-mail.
- Painel da pesquisa: consultas em `import_jobs` e `source_health` (taxa de sucesso por fonte, tempo, falhas de imagem).

---

## 17. Custo (qualitativo — confirmar preços na contratação)

| Fase | Hospedagem | Banco | Storage/CDN | Auth/e-mail | Busca | Total |
|---|---|---|---|---|---|---|
| 1 usuário | Baixo (1 serviço, cobrança por uso) | Gratuito | Gratuito | Gratuito | Gratuito ou mínimo | **Baixo** (domínio ~US$ 10–15/ano + poucos US$/mês) |
| 100 | Baixo | Gratuito ou mínimo | Gratuito | Gratuito | Baixo | **Baixo** |
| 1.000 | Médio (web + worker separados) | Baixo/médio | Baixo | Baixo | Médio | **Médio** |
| 10.000 | Médio/alto (réplicas do worker) | Médio | Baixo (saída grátis) | Médio (volume de e-mail) | Médio (contido pelo catálogo) | **Médio/alto** |

Principais fatores: processamento das pesquisas (memória/CPU do worker), consultas pagas de busca, volume de e-mail.
Imagem/CDN barata porque o R2 não cobra saída. Conta de desenvolvedor Apple (US$ 99/ano) só com o app nativo.

---

## 18. Arquitetura final recomendada

```
USER (navegador · PWA · depois iOS/Android)
  ↓
AUTH ─ Better Auth (código por e-mail; Google/Apple depois) · sessão em cookie / token no nativo
  ↓
FRONTEND ─ React 19 + Vite (build estático servido pelo serviço web; /assets via CDN)
  ↓
API ─ Node + Hono · /api/v1 · HTML com prévias Open Graph · Railway (serviço "web")
  ↓
DATABASE ─ Neon Postgres (Frankfurt) · Drizzle · pg-boss (fila no mesmo banco)
  ↓
STORAGE ─ Cloudflare R2 · img.dominio.com · chaves pelo conteúdo · lixeira de 30 d
  ↓
BACKGROUND JOBS ─ Railway (serviço "worker"): pesquisa · recorte (BiRefNet + sharp) · prévias · limpeza · backup
  ↓
EXTERNAL SOURCES ─ catálogo interno → página do link → lojas oficiais/revendedoras → base de perfumes → Brave Search API

DOMAIN  dominio.com (Cloudflare Registrar)     DNS  Cloudflare · www → apex · img → R2
HTTPS   Cloudflare borda + Railway origem ("Full strict") · HSTS     CDN  Cloudflare
E-MAIL  Resend (SPF/DKIM/DMARC)     OBSERVABILIDADE  Sentry · logs do Railway · monitor de disponibilidade
```

**Alternativas descartadas:** Vercel/Netlify/Cloudflare Workers (não rodam o motor de imagem) · Render/Fly.io (boas,
mais caras ou com mais administração para o mesmo resultado) · VPS (administrar SO sozinho) · Supabase/Firebase
(duplicação de regras ou não relacional) · SQLite (prende a uma máquina) · S3 (custo de saída) · Clerk (custo e
dependência) · magic link (quebra no PWA do iPhone) · Redis/BullMQ (serviço extra quando o Postgres dá conta) ·
serviço externo de recorte (custo e perda do controle de qualidade).

---

## 19. Ordem de implementação

Ajustes em relação a um plano ingênuo: a **migração dos dados atuais não é fase separada** (acontece dentro das fases
de banco e storage, com comparação de ida e volta API antiga × nova), e as **tarefas em segundo plano vêm antes do
deploy** (sem elas, importar pelo celular é frágil desde o primeiro dia).

| Fase | O quê | Por que nessa ordem |
|---|---|---|
| 0 · Git + backup + CI | Repositório privado no GitHub, testes a cada push, script de backup | Rede de segurança |
| 1 · Reorganização local | Hono, `/api/v1`, interfaces de repositório e storage, config por variáveis de ambiente, correções de segurança da §14 | Troca as peças sem trocar o comportamento |
| 2 · Banco | Neon (branch de dev) + Drizzle + migração do `library.json` verificada | Fonte de verdade antes de ir para a internet |
| 3 · Storage | R2 + chaves pelo conteúdo + migração das imagens verificada + limpeza | Estado fora da máquina |
| 4 · Tarefas | pg-boss: importação como tarefa, cache e disjuntores no banco | Robustez no celular e ao reiniciar |
| 5 · Deploy privado | Dockerfile, Railway (web + worker), domínio, Cloudflare, HTTPS, Sentry, monitor, backups | No ar só para o dono (código de acesso ainda vale) |
| 6 · Contas | Better Auth com código por e-mail; dados atuais passam para a conta do dono; fim do código de acesso | Abre para outras pessoas com segurança |
| 7 · Perfil + wishlist/coleção por usuário | Username, nome, avatar, bio, privacidade; isolamento por dono testado | Base do compartilhamento |
| 8 · Compartilhamento | Botão, imagem de prévia 1200×630, testes em WhatsApp, iMessage, Telegram, Discord, Messenger | Precisa de domínio e perfil |
| 9 · PWA mobile | Aviso de atualização, splash iOS, instalação, Share Target, infraestrutura de push | Precisa de HTTPS e contas |
| 10 · Presentes | Reservas com transação e token anônimo; aviso ao dono sem revelar quem | Precisa de banco transacional e público |
| 11 · Preparação nativa | OpenAPI + cliente gerado, `packages/core`, tokens em JSON, universal links | Antes de escrever o app |
| 12 · App nativo | Expo + Apple Sign In + Share Extension | Com o produto validado |

**Pendências de decisão do dono antes da fase 0:** domínio; contas em GitHub, Railway, Neon, Cloudflare e Resend
(criadas pelo dono); destino do protótipo publicado no claude.ai (vitrine ou aposentar).
