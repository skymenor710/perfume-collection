# Arquitetura — auditoria e plano (27/09/2026)

Documento vivo. A seção "Auditoria" descreve o estado ENCONTRADO antes desta etapa; "Implementado" diz o que
mudou; "Plano" traz as fases seguintes, que esperam aprovação antes de qualquer mudança visual grande ou nativa.

---

## 1. Auditoria

### 1.1 Stack

| Camada | Hoje | Observação |
|---|---|---|
| Front | Vite 8 + React 19 + TypeScript 5.9, CSS próprio (tokens em `src/styles/tokens.css`), WebGL2 próprio (`src/gl/galaxy.ts`), three.js só para modelo 3D real (carregado sob demanda; nenhum perfume tem hoje) | Sem framework de rotas: uma tela só, estado em `src/app.tsx` |
| Domínio compartilhado | `src/core/*` (TS puro: modelo, cor, recorte, correspondência de nomes, notas, qualidade) | **Bom para nativo**: não depende do DOM (exceto `photo.ts`, em `src/lib`) |
| Acesso a dados no front | `src/data/repository.ts` — interface `Repository` com 3 implementações: servidor, claude.ai (db do artifact), navegador (localStorage) | **Bom**: a UI não sabe onde os dados moram |
| Back | Node (tsx) HTTP puro em `server/` — API JSON + NDJSON (progresso) + SSE (sincronização entre aparelhos) | Sem framework; pequeno e auditável |
| Banco | **Arquivo JSON** `data/perfumes.json` (lista plana), gravação atômica (tmp + rename) | Ver 1.2 |
| Imagens | `data/media/<aleatório>.{png,webp}` (importadas) e `public/bottles/*` (planilha) | Ver 1.4 |
| Autenticação | Nenhuma conta. Localhost sempre liberado; outro aparelho da rede com **código de acesso** (cookie HttpOnly, SameSite=Strict) | Um dono implícito; ver 1.5 |
| Pesquisa | `server/resolver` (produto primeiro), `server/research` (lojas Shopify, Parfumo, Fragrantica), `server/import` (extração, variantes), `server/media` (recorte BiRefNet via onnxruntime + controle de qualidade, num worker) | Toda no servidor — correto |
| Execução | `npm run app` / atalho: servidor como processo próprio do Windows, `http://localhost:3100` | Só neste PC e na Wi-Fi de casa |
| Link do claude.ai | Mesmo front, compilado num arquivo, dados no `db` do artifact | Sem internet (regra da plataforma); coleção **separada** |

### 1.2 Banco / modelo de dados — o que está errado para a nova direção

1. **Produto e relação da pessoa estão misturados num registro só.** Cada item de `perfumes.json` tem dados do
   PERFUME (marca, nome, notas, foto, variantes) e da PESSOA (`status` wishlist/coleção, `personalRating`,
   `acquiredAt`, `order`). Com dois usuários, o mesmo perfume teria de ser duplicado inteiro — e uma correção de
   foto num não chegaria ao outro.
2. **Wishlist e coleção são um campo (`status`)**, não relações. Não há posição por lista nem observação.
3. **Nenhuma entidade de usuário**: não há username, nome, avatar, bio nem privacidade. Não há como montar
   `/username/wishlist`.
4. **Variantes existem desde a V4** (`variants[]`, `selectedVariantId`, `variantUrl`), mas presas ao registro da
   pessoa; `volume` ainda é texto livre e aparece "50/100 ml" em itens antigos (Empire).
5. **Uma imagem por perfume** (`imageUrl`/`thumbUrl`/`masterUrl` + `imageSource`): não há imagens alternativas,
   nem ligação imagem ↔ variante no registro guardado (a pesquisa já liga, mas descarta a ligação ao salvar).
6. IDs: estáveis (`marca-nome-xxxxxx`), sem colisão — **podem ser preservados**. Sem duplicados por marca+nome.
7. **Duas fontes de verdade**: `data/perfumes.json` (computador) e o `db` do link do claude.ai. Não sincronizam.
8. Versão do arquivo `version: 1` existe mas não havia migração por versão (só "upgrade da planilha").

### 1.3 Por que funcionava no Claude e falhava no Chrome (corrigido na V4, registrado aqui)

- O servidor era **processo filho do app do Claude** (painel de pré-visualização): fechar o Claude o matava.
- O recorte rodava na **linha principal** e travava o servidor até 4 s; a página aberta nesse instante concluía
  "sem servidor" e **caía silenciosamente** no modo só-navegador, que não abre links.
- Correções: worker de imagem, marca `perfumes-server` no index (a página nunca rebaixa), atalho que sobe o
  servidor como processo próprio. Teste no Google Chrome real: 10/10.
- **Nada do produto depende de ferramentas de desenvolvimento** (Claude, MCP, Playwright, extensão). Playwright e
  o Edge/Chrome headless são usados **só nos testes** (`scripts/smoke.mjs`, `scripts/chrome-real.mjs`).

### 1.4 Imagens — auditoria

| Tema | Estado |
|---|---|
| Formato final | PNG mestre 2048² transparente + WebP 1024/384 com alfa, quadro padrão (base a 92%) — bom |
| Controle de qualidade | Nota por recorte (IA, cor, fusão), **apoio de borda** (contorno precisa seguir bordas reais), névoa sem evidência removida, laço que troca de fonte — bom |
| Variante ↔ imagem | Pesquisa respeita o tamanho; **o vínculo não é guardado** |
| Alternativas | **Não guardadas** (só a vencedora) |
| Proveniência | `imageSource` (origem, URL, página, rótulo, nota) — bom, falta tipo/transparência/confiança explícitos |
| **Arquivos órfãos** | **17 de 23 arquivos em `data/media` não eram usados** (cada "pesquisar de novo" e cada prévia cancelada deixava arquivos; a remoção apagava os WebP mas nunca o PNG mestre) — **crítico, corrigido** |
| Imagens em página pública | `/media/*` exige estar autorizado — **uma página pública não mostraria as fotos** (corrigido para itens públicos) |

### 1.5 Segurança — auditoria

| Tema | Estado |
|---|---|
| SSRF | **Bom**: só http(s), IP privado bloqueado na resolução DNS da conexão (contra rebinding), a cada redirecionamento, limite de tamanho e tempo |
| Host / DNS rebinding | Host conferido em toda requisição — mas **só aceita endereços locais**: um domínio público seria recusado (421). Precisa de lista configurável para produção |
| CSRF | Mudanças exigem mesma origem (Origin / Sec-Fetch-Site) + cookie SameSite=Strict — bom |
| Autenticação | Código de acesso por aparelho, comparação em tempo constante, 6 tentativas/15 min — bom para uso doméstico; **não é conta de usuário** |
| Entrada | Zod nas rotas, `sanitizePerfume` em tudo que entra, HTML nunca injetado — bom |
| Abuso | **Importação sem limite de concorrência**: um aparelho pareado podia enfileirar pesquisas pesadas sem fim — corrigido |
| Identificação na web | O leitor de páginas **se apresentava como Chrome** (User-Agent de navegador). Para um app que respeita robots.txt e termos, isso é disfarce — corrigido para um User-Agent honesto |
| Segredos | `.env.local` (código de acesso, chave opcional da Brave) fora do front — bom |
| Dependências | `npm audit`: 0 vulnerabilidades |

### 1.6 Chrome / mobile

- Galáxia com 3 níveis de qualidade, DPR limitado, pausa quando a aba some — bom.
- Alvos de toque 44 pt, áreas seguras do iPhone (`env(safe-area-inset-*)`), `viewport-fit=cover` — bom.
- **Caminhos relativos em tudo** (`base: './'`, `fetch('api/…')`, `bottles/…`, `media/…`): funciona em `/`,
  mas **quebra em `/guilherme/wishlist`** (arquivos e API seriam pedidos em `/guilherme/api/…`) — bloqueava URLs
  públicas; corrigido no modo servidor (o link do claude.ai continua relativo, como precisa).
- **PWA inexistente**: sem manifest, sem ícones de instalação, sem service worker, sem apple-touch-icon.
- iPhone/Android pela Wi-Fi usam `http://192.168…` — **service worker e instalação completa exigem HTTPS**
  (o navegador só libera em `localhost` ou HTTPS). Ver Riscos.

### 1.7 Futuro app nativo — o que reaproveita e o que prende ao navegador

| Reaproveita | Preso ao navegador (isolar antes de ir para nativo) |
|---|---|
| `src/core/*` inteiro (modelo, cor, correspondência, notas, qualidade) | `src/gl/galaxy.ts` (WebGL2 direto) → num app nativo vira expo-gl/Skia com o mesmo shader |
| Toda a pesquisa e processamento (servidor) → já é "API" | `Stage.tsx` (CSS 3D + ponteiro) → reescrever com Reanimated/Skia mantendo a matemática da mola |
| Contrato da API (`/api/...` JSON + NDJSON) | `src/lib/photo.ts` (canvas) — só usado no modo sem servidor |
| Interface `Repository` | `src/data/claude.ts` (específico do claude.ai) |
| Tokens de design (`tokens.css`) → exportáveis para JSON | CSS de componentes (reescrito em nativo; tokens compartilhados) |

**Conclusão**: não migrar agora. O que mais ajuda o nativo é (a) o domínio em `src/core` sem DOM, (b) a API como
fronteira única, (c) tokens de design exportáveis. As duas primeiras já existem; a terceira entra no plano.

### 1.8 O que NÃO deve ser alterado

A estética (galáxia, tipografia Archivo larga, sotaque vindo do frasco, palco 3D, close-up com pirâmide), o
resolvedor produto-primeiro, o controle de qualidade de imagem, o contrato visual dos componentes, os IDs dos
perfumes existentes, e os dados da pessoa (status, veredito, datas, ordem).

---

## 2. Arquitetura proposta

### 2.1 Entidades (contextos: Catálogo · Biblioteca · Identidade · Aquisição)

```
USER (Identidade)                      PRODUCT (Catálogo) — o perfume, compartilhável entre usuários
  id, username (único), displayName      id, brand, name, concentration, gender, description
  avatarUrl?, bio?                        olfactoryProfile, fieldSources, model3DUrl
  privacy { profile, wishlist,            variants[]  ─┐  VARIANT: id, label, volume, volumeMl?, price,
            collection: public|private }               │  currency, sku, available, url
                                                       │
ENTRY (Biblioteca) — a relação da pessoa com o produto  images[] ─┐  IMAGE: id, url(lg), thumbUrl(sm), masterUrl(PNG),
  id, userId, productId, list: wishlist|collection   │         role main|alternate, variantId?, transparent,
  variantId? (a versão escolhida)                    │         dominantColor, colorOverride?, accent,
  position, notes?, rating?, addedAt, acquiredAt?    │         source{origin,url,pageUrl,label}, score, confidence
  sourceUrl (o link que a pessoa colou), variantUrl?
  price snapshot (o preço que ela viu)
```

- **PRODUCT ≠ VARIANT ≠ ENTRY.** O 50 ml e o 100 ml são variantes do mesmo produto; a entrada da pessoa aponta
  para UMA variante. Foto, preço e link da variante andam juntos.
- A **API continua entregando a "visão" antiga** (`Perfume` = entrada + produto + imagem principal), montada no
  servidor. Assim a interface atual não muda nada, e a troca de armazenamento é invisível.
- **Presentes (futuro)**: tabela `reservations { id, entryId, tokenHash, createdAt, message? }` — quem reserva
  recebe um token secreto; o dono vê "reservado", nunca quem. Entradas têm ID estável desde já, que é o que essa
  funcionalidade precisa. **Não implementado** (depende de contas/hospedagem pública).

### 2.2 URLs públicas

`/{username}`, `/{username}/wishlist`, `/{username}/collection` — servidas pelo MESMO app (mesma galáxia, palco e
tipografia), só leitura. O servidor monta `<title>`, description, canonical, Open Graph e Twitter card por página,
e só expõe o que a privacidade permite (padrão: **tudo privado**).

### 2.3 Produção real (o que falta para "dominio.com/guilherme")

Hoje o app roda neste PC. Para links abertos por qualquer pessoa na internet é preciso **hospedagem** (servidor
Node com disco persistente, ou banco gerenciado + armazenamento de imagens), **HTTPS**, e **contas** (login real).
Nada disso é simulável: está no plano como fase própria e depende de escolhas suas (provedor, domínio, custo).

---

## 3. Plano por fases

Cada fase preserva o que funciona: a API mantém a "visão" `Perfume`, testes (unitários, smoke no Edge, Chrome real)
rodam a cada fase, e toda migração de dados é versionada, com cópia do arquivo antigo.

| Fase | O quê | Arquivos | Banco | API | Riscos / dependências |
|---|---|---|---|---|---|
| **1 · Arquitetura** (feita nesta etapa) | Caminhos absolutos no modo servidor; limpeza de mídia órfã; limite de importações; User-Agent honesto; hosts públicos configuráveis | `vite.config.ts`, `src/data/repository.ts`, `src/lib/refs.ts`, `server/media/gc.ts`, `server/net/safe-fetch.ts`, `server/http/*` | — | — | Baixo; coberto pelo smoke |
| **2 · Usuário** (base feita) | Entidade USER com username único, perfil e privacidade; `GET/PATCH /api/me` | `src/core/library.ts`, `server/store.ts`, `server/http/app.ts` | `data/library.json` (schema 2) | `/api/me` | Sem login real ainda: o dono é quem passa no código de acesso |
| **3 · Produto / versões** (base feita) | PRODUCT com `variants[]` e `images[]` (principal + alternativas ligadas a variante) | `src/core/library.ts`, `server/import/pipeline.ts` | produtos | visão `Perfume` inalterada | Itens antigos "50/100 ml" continuam pedindo "Escolher versão" |
| **4 · Listas por usuário** (base feita) | ENTRY (wishlist/coleção, posição, observação, variante) | idem | entradas | idem | Edição de dados do produto por um usuário afeta o produto — com vários usuários vira sobrescrita por entrada (pendente) |
| **5 · URLs públicas** (base feita, local) | `/{username}[/wishlist\|/collection]` só leitura, metadados OG, fotos públicas | `server/http/app.ts`, `server/http/seo.ts`, `src/data/repository.ts` | — | `/api/public/...` | Só alcança quem está na mesma rede até existir hospedagem |
| **6 · Compartilhar** | Botão "Compartilhar" (Web Share API no celular, copiar link no desktop), escolher o que tornar público | `Nameplate`/`Chrome`, folha nova | privacidade | `PATCH /api/me` (já existe) | **Espera aprovação visual** |
| **7 · PWA** (base feita) | Manifest, ícones, service worker (cache de app e fotos; leitura offline da última lista), instalação | `public/manifest.webmanifest`, `public/sw.js`, `index.html`, `src/main.tsx` | — | — | Instalação completa em celular exige HTTPS (fase 7b com hospedagem) |
| **8 · Nativo** | Tokens de design exportados, contrato da API documentado (OpenAPI), cliente de API sem DOM, decisão Expo × PWA com dados reais de uso | `src/core`, `docs/api.md` | — | versão da API | Não migrar antes de a PWA estar em uso |

### Próxima fase recomendada
**Hospedagem + contas** (pré-requisito de URLs públicas de verdade, PWA instalável e presentes), seguida do
**botão Compartilhar** com a sua aprovação visual.

---

## 4. Implementado nesta etapa (27/09/2026)

Sem mudança visual: a interface continua recebendo a mesma "visão" `Perfume`. Verificação: 66 testes unitários,
smoke 56/56 (Edge: fluxos, celular, versões, PWA, página pública), variante do claude.ai, Chrome real (service
worker ativo e **app abrindo sem rede**).

| Tema | O que mudou | Arquivos |
|---|---|---|
| Modelo | USER / PRODUCT (com `variants[]`, `images[]`, `appearance`) / ENTRY (lista, versão, posição, veredito, observação, link, preço visto) | `src/core/library.ts` (novo) |
| Armazenamento | Biblioteca normalizada; API entrega a visão antiga; seed upgrade por visão; remoção apaga produto órfão | `server/store.ts` (reescrito) |
| **Migração 1 → 2** | `data/perfumes.json` → `data/library.json`; original guardado em `data/perfumes.v1-migrado.json` e `data/perfumes.v1-<data>.json`. Ensaio numa cópia e na real: **15/15 perfumes idênticos, mesma ordem** | automático na partida |
| Usuário | `GET/PATCH /api/me` (username único validado, nomes reservados, nome, bio, privacidade) — padrão **tudo privado** | `server/http/app.ts`, `src/core/library.ts` |
| URLs públicas | `/{username}`, `/{username}/wishlist`, `/{username}/collection`: mesmo palco, só leitura; `GET /api/public/...` com limite por endereço; fotos de itens públicos servidas sem código; título, description, canonical, Open Graph e Twitter card montados no servidor; 404 quando privado | `server/http/seo.ts` (novo), `server/http/app.ts`, `src/data/repository.ts`, `src/app.tsx`, `src/components/Chrome.tsx` |
| Caminhos | Base absoluta no modo servidor (`/api`, `/bottles`, `/media`); relativa no claude.ai | `vite.config.ts`, `src/lib/refs.ts` (novo), `Bottle.tsx`, `AddPerfume.tsx` |
| PWA | Manifest, ícones 192/512/maskable/apple-touch, tags de instalação do iPhone, service worker (cache do app e fotos, leitura offline da última coleção) | `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*`, `scripts/make-icon.mjs`, `src/main.tsx`, `server/http/seo.ts` |
| Mídia órfã | Limpeza na partida e a cada 6 h (carência de 6 h) — já removeu 3 arquivos antigos | `server/media/gc.ts` (novo), `server/main.ts` |
| Abuso | No máximo 2 pesquisas pesadas simultâneas (resposta clara); vaga liberada ao terminar | `server/http/app.ts` |
| Identificação honesta | User-Agent do app em vez de disfarce de navegador (fontes testadas aceitam) | `server/net/safe-fetch.ts` |
| Resiliência da pesquisa | Buscador pausado ainda usa o que está em cache; página com nome e sem marca identifica pelo catálogo da base (sem buscador) | `server/resolver/search.ts`, `server/resolver/resolve.ts` |
| Produção | Domínio público configurável (`PERFUMES_PUBLIC_ORIGIN`) aceito no Host e usado nos links canônicos | `server/config.ts`, `server/http/guard.ts` |

Cópia de segurança antes de tudo: `Desktop/perfume-collection-backup-20260927-170950`.

## 5. Pendente (não implementado — de propósito)

- **Contas e login** (senha/Apple/Google): hoje o dono é quem passa pelo código de acesso. Sem isso, não existe
  segundo usuário de verdade. Não foi simulado.
- **Hospedagem pública + HTTPS**: `dominio.com/guilherme` para qualquer pessoa; instalação PWA completa no celular
  (hoje só em `localhost`); prévias no WhatsApp (o robô do WhatsApp precisa alcançar o endereço).
- **Botão "Compartilhar" e tela de privacidade** — a API existe (`PATCH /api/me`); a UI espera sua aprovação.
- **Presentes** — modelo descrito em 2.1; depende de contas/hospedagem.
- **Imagens alternativas preenchidas pela pesquisa** — o modelo guarda; o resolvedor ainda salva só a vencedora.
- **Imagem de prévia própria (1200×630)** com o frasco sobre a galáxia — hoje a prévia usa a foto quadrada.
- **Sobrescritas por usuário** (corrigir nome/foto só para si quando vários usuários compartilham um produto).
- **Link do claude.ai**: continua com o formato antigo no banco do artifact (coleção separada, só vitrine).
- **Git**: o projeto não tem controle de versão; recomendado antes da próxima fase.

## 6. Riscos

- Iniciar com Windows não instalado: se o PC reiniciar, o app só volta pelo atalho.
- Celular pela Wi-Fi (`http://192.168…`): sem service worker (exigência do navegador); funciona, mas não offline.
- DuckDuckGo pede verificação depois de poucas buscas; a identificação não depende mais dele, mas links sem marca
  escrita ainda ganham com uma chave da Brave.
- Imagens de páginas públicas: servidas pelo seu PC — expor à internet sem hospedagem exigiria abrir porta no roteador
  (não recomendado).
