# Meus Perfumes — V4

Coleção pessoal de perfumes (Wishlist + Coleção) num seletor estilo "character select", com a galáxia tingida pela cor
de cada frasco, close-up com a **pirâmide olfativa** e importação **só pelo link**.

## O app é o do computador

A coleção de verdade é o **app do computador**: um servidor próprio (Node) que serve a página E faz a pesquisa.
O navegador nunca abre lojas — ele manda o link para `POST /api/perfumes/resolve` e o servidor resolve.
Nada disso depende do Claude, de MCP, de extensão ou de Playwright: são ferramentas de desenvolvimento.

**Abrir:** dê dois cliques em **Meus Perfumes** na Área de Trabalho (ou `npm run app`). O atalho sobe o servidor
como processo próprio do Windows — não é filho de terminal, do Claude nem de nada — e abre o navegador em
http://localhost:3100. Fechar o Claude, o terminal ou o navegador não derruba o app. Log em `data/logs/server.log`.
Parar: `npm run app:stop`. (Opcional: iniciar junto com o Windows — ver "Inicialização" abaixo.)

Por que antes "funcionava no Claude e falhava no Chrome" (corrigido em 27/09/2026):
1. o único servidor rodando era filho do app do Claude (o painel de pré-visualização): fechar o Claude o matava;
2. o recorte das fotos rodava na linha principal e travava o servidor por até 4 s — uma página aberta nesse
   momento concluía "não há servidor" e caía no modo só-navegador, que não sabe abrir links;
3. esse rebaixamento era silencioso. Agora: recorte num worker (pior resposta durante uma importação: 37 ms),
   a página servida pelo app traz uma marca e nunca rebaixa, e o app sobe sozinho pelo atalho.

| | App do computador | Link do claude.ai |
|---|---|---|
| Onde | http://localhost:3100 no PC; no celular (mesma Wi-Fi), o endereço do log, com código de acesso uma vez | https://claude.ai/artifact/W41mJJARPCBA5Sbe16bZPG |
| Dados | `data/perfumes.json` neste PC | na sua conta Claude |
| Adicionar por link | **completo**: produto primeiro, versão (50/100 ml), melhor foto, notas | a página não tem internet (regra do claude.ai): lê o endereço e oferece **"Pesquisar no app do computador"**, que abre o app com o link já colado |

As duas coleções são independentes.

```bash
npm install
npm run app
```

## Versões (50 ml × 100 ml) — `server/import/variants.ts`

Produto ≠ variante. O perfume guardado é UMA variante real: tamanho + preço + moeda + SKU + link da variante +
FOTO da variante, sempre juntos (nunca "50 ml com a foto do 100 ml"). Fontes: JSON público da Shopify
(`/products/<handle>.js`, cada variante com sua foto), formulário de variações do WooCommerce, JSON-LD
(`ProductGroup.hasVariant` ou várias ofertas). Loja do link bloqueada → variantes da loja oficial/revendedora.
- Mais de uma versão → o app pergunta ANTES de pesquisar fotos, com o frasco de cada uma. `?variant=` (Shopify),
  atributos do WooCommerce ou um único tamanho no endereço pré-selecionam; nada de "primeira variante".
- Escolhida a versão: a foto dela é a referência exata, fotos ligadas a outro tamanho são reprovadas, e as buscas
  levam o tamanho ("Mykonos Reflection 50ml"). O ↗ abre o link da variante (ex.: `?variant=58518844047705`).
- Perfumes antigos com várias versões e nenhuma escolhida mostram "Escolher versão"; o menu tem "Trocar versão".

## Controle de qualidade da foto — `server/media/process.ts`, `server/research/perfume.ts`

- Candidatas de várias fontes (loja oficial — inclusive descoberta: `marca.com` que vende perfume —, página do
  link, variante, base de perfumes, revendedoras, busca de PNG); triagem rápida em todas, recorte completo (IA +
  cor + fusão) nas cinco melhores; **se nenhuma passar, segue para a próxima fonte** até uma passar — ou fica a
  silhueta: nenhuma foto vale mais que uma ruim.
- **Apoio de borda**: o contorno do recorte tem de passar por bordas reais da foto. Recorte certo: 0,97–1,00
  (inclusive branco no branco); o Zefiro "mordido" dava 0,80 e agora é reprovado (< 0,85).
- **Névoa inventada pela IA** (fantasma branco acima da tampa): sai só a região cujo contorno não tem borda na foto
  — frasco branco no branco fica, porque o contorno dele existe na imagem.

## Resolvedor "produto primeiro" (servidor) — `server/resolver/`

O link colado é **uma pista**, não a fonte da verdade. Nenhuma etapa derruba o processo sozinha.

```
link → normalização (sem rastreadores; o original fica guardado para o ↗)
     → página do link, SE abrir                      (DirectPage — opcional)
     → leitura do endereço: marca/nome/ASIN/EAN       (UrlParser; nome antes de /dp/, sem códigos de loja)
     → catálogo da marca na base de perfumes         (FragranceDatabase — SEM buscador: "cdn-intense-man-edt"
                                                        vira Armaf · Club de Nuit Intense Man EDT)
     → busca na internet, consultas progressivas     (Search: DuckDuckGo HTML sem chave, ou Brave API com chave)
     → confirmação da identidade (várias fontes concordam?)
         alta → entra direto na wishlist · moderada → prévia "é este?" · nenhuma → "qual perfume é este?"
     → dados de várias fontes, cada campo com a sua origem (fieldSources)
         identidade: oficial → loja do link → revendedora → base → busca
         notas:      oficial → Fragrantica/Parfumo → revendedora
         fotos:      oficial → PNG transparente → revendedora → busca de imagem
     → fotos candidatas → recorte (IA BiRefNet + cor, fusão) → nota de qualidade → outra candidata se reprovar
     → quadro padrão: PNG 2048² transparente, frasco ≤72%×84%, base na linha de 92% (src/core/canvas.ts)
     → cor dominante → sotaque da galáxia → pirâmide olfativa com fonte
```

- **Recorte**: modelo BiRefNet-lite (MIT, ~224 MB, baixado uma vez para `data/models/`) roda no próprio PC via
  onnxruntime; o recorte por cor entra como segunda opinião e a fusão devolve partes claras que a IA perde. Sombra
  e halo do fundo são descontados; se uma variante "come" parte do frasco, ela perde para as outras.

- **Qualidade da foto** (`src/core/quality.ts`): recusa frasco cortado, caixa/objetos ao lado (a tampa separada não conta),
  fundo escuro de campanha, névoa/brilho, contorno corroído, halo, baixa resolução; compara cor e silhueta com a foto do
  produto exato (pega variante errada, como Precieux I × IV). Preferência pela loja oficial só desempata fotos sem defeito.
- **Notas** (`src/core/olfactory.ts`): oficial → base de perfumes → revendedora. Texto de marketing não vira nota; nada de porcentagem.
- **Correspondência** (`src/core/match.ts`): variantes (Noir, Intense, Elixir, IV…) e concentração (EDT × EDP) contam.
- **Sem ponto único de falha**: página que redireciona para outro produto ou devolve 404 é descartada (o endereço
  vale mais); o catálogo da marca identifica links legíveis mesmo com o buscador fora do ar; ambiguidade
  (Man × Woman) nunca entra sozinha — vira a prévia "É este o perfume?".
- **Boas maneiras**: robots.txt respeitado (a busca usa o endereço HTML do DuckDuckGo, liberado no robots.txt dele),
  1 pedido a cada 1,5 s por site, cache em `data/cache`, nenhum bloqueio ou verificação anti-robô contornado —
  site que bloqueia vira "Buscando o produto em outras fontes…".
- **Buscadores e robots.txt**: DuckDuckGo HTML permite leitura automática mas pede verificação depois de poucas
  buscas; Mojeek, Qwant, Startpage, Yahoo e Ecosia proíbem no robots.txt. Por isso a identificação não depende de
  buscador (página, JSON da loja, endereço, catálogo da base de perfumes, lojas oficiais) e a busca é reforço.
- **Busca com chave (opcional, recomendada)**: `BRAVE_SEARCH_API_KEY=…` no `.env.local` usa a API da Brave antes do DuckDuckGo.

## Migração da coleção

`npm run seed:research` reprocessa os 14 da planilha pelo mesmo resolvedor (a foto antiga entra só como candidata).
Webp do palco em `public/bottles/`, PNG mestre 2048² em `assets/masters/` (fora do site, para não pesar no link).
Relatório por perfume em `scripts/.shots/research-report.json` e prancha sobre xadrez (transparência e piso visíveis)
em `research-sheet.png`. Os sete tipos de link do pedido: `npx tsx scripts/url-kinds.ts` → `scripts/.shots/url-kinds.{json,png}`.
Quem já tem `data/perfumes.json` recebe as fotos e perfis novos no próximo `npm start` (status e vereditos preservados).

## Limites conhecidos (27/09/2026)

- **Fragrantica** pede verificação anti-robô ao servidor: fica em pausa 6 h e o **Parfumo** assume (mesmo tipo de dado).
- **notino.fr, Cdiscount, Amazon, dior.com, Sephora** não deixam ler a página: o perfume é identificado pelo endereço + busca, e o resto vem de outras fontes.
- **DuckDuckGo** pede verificação depois de poucas buscas seguidas vindas do mesmo PC: a busca pausa 30 min (sem contornar),
  o cache continua valendo e o catálogo da base de perfumes segue identificando. Links sem marca escrita
  (ex.: sephora.fr/p/good-girl…-P3372018) precisam do buscador — sem ele, o app pergunta "Qual perfume é este?".
  Uma chave gratuita da Brave (`BRAVE_SEARCH_API_KEY`) resolve de vez.
- Marcas sem loja Shopify (ex.: Dior) podem ficar sem foto aprovada; aí fica a foto enviada.
- Tradução de notas cobre as mais comuns; as demais aparecem como na fonte.

## Verificação

```bash
npm test
```
```bash
npm run typecheck
```
```bash
npm run build && npm run smoke
```
```bash
npm run build:artifact && npm run smoke:artifact
```

`smoke` sobe um servidor com dados temporários e percorre os fluxos no Edge headless, incluindo uma
importação real só pelo link e o close-up com a pirâmide (capturas em `scripts/.shots/`).

## Inicialização

- **Meus Perfumes** (atalho na Área de Trabalho) ou `npm run app`: sobe o servidor se preciso e abre o navegador.
- `npm run app:autostart`: o servidor passa a subir sozinho ao entrar no Windows (atalho na pasta Inicializar do
  seu usuário; sem administrador). `npm run app:autostart -- -Remove` desfaz.
- `npm run app:stop`: encerra o servidor.
- Testes: `npm test`, `npm run smoke` (48 verificações, Edge headless), `node scripts/chrome-real.mjs <link>`
  (Google Chrome instalado, perfil limpo, contra o app rodando sozinho — inclui abrir outra aba no meio de uma importação).
