---
name: Meus Perfumes
description: Seleção de personagem para perfumes, num espaço escuro tingido pelo frasco escolhido.
colors:
  void: "#050507"
  void-raised: "#0b0b0f"
  void-panel: "rgb(9 9 12 / 0.94)"
  hairline: "rgb(255 255 255 / 0.09)"
  hairline-strong: "rgb(255 255 255 / 0.17)"
  text: "#eceef2"
  text-2: "#a9adb6"
  text-3: "#80858f"
  silver: "#c9ccd2"
  accent: "#c7cad0"
  danger: "#e2a3a3"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.9rem, 1.1rem + 3.4vw, 4.1rem)"
    fontWeight: 250
    lineHeight: 0.98
    letterSpacing: "0.015em"
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1rem + 0.8vw, 1.6rem)"
    fontWeight: 300
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 125"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    letterSpacing: "0.02em"
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.18em"
    fontVariation: "'wdth' 112"
rounded:
  xs: "2px"
  sm: "4px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  gutter: "clamp(16px, 3.2vw, 48px)"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.void}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "46px"
  button-action:
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px 0 18px"
    height: "46px"
  button-round:
    textColor: "{colors.silver}"
    rounded: "{rounded.pill}"
    size: "44px"
  button-add:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 18px 0 14px"
    height: "40px"
  tab:
    textColor: "{colors.text-3}"
    typography: "{typography.label}"
    padding: "0 18px"
    height: "40px"
  tab-active:
    textColor: "{colors.text}"
  chip-verdict:
    textColor: "{colors.text-2}"
    typography: "{typography.body-small}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 10px"
    height: "40px"
  chip-verdict-on:
    textColor: "{colors.text}"
  stamp:
    textColor: "{colors.accent}"
    rounded: "{rounded.xs}"
    padding: "0 18px 0 16px"
    height: "46px"
  input-field:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "46px"
  sheet:
    backgroundColor: "{colors.void-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    width: "min(560px, calc(100vw - 32px))"
---

# Design System: Meus Perfumes

## Overview

**Creative North Star: "A Tela de Seleção no Espaço"**

Um frasco sozinho sobre uma poça de luz, no meio do espaço profundo; o resto do elenco recua em diagonal para a escuridão, menor e mais apagado. A interface é um HUD de jogo: rótulos largos em caixa alta, linhas de prata finíssimas, controles em pílula vazada. Não há cartões, não há grade de loja, não há barra lateral de painel. O frasco é o protagonista e nada compete com ele.

O mundo é preto, carvão e prata. A única cor vem do frasco selecionado: extraída da foto, domesticada em OKLCH (luminosidade presa entre 0,68 e 0,80, croma entre 0,07 e 0,145; frascos neutros viram prata fria) e escrita em tempo real na variável de sotaque. Ela vive nas estrelas, na nebulosa atrás do frasco, no cone de luz, na poça do piso, no anel de foco e no carimbo do veredito, e só ali. Arrastar entre dois frascos mistura as duas cores em OKLab; a troca nunca corta, sempre se dissolve (constante de tempo de 0,45 s).

A densidade é baixa e a composição é ancorada nos cantos: identidade no alto, placa com o nome embaixo à esquerda, contador e setas embaixo à direita, palco livre no centro. No celular a mesma cena empilha, com a placa e a ação presas acima da área segura.

**Key Characteristics:**
- Espaço quase preto (galáxia WebGL própria) como único fundo; nenhum painel opaco no palco.
- Um sotaque dinâmico derivado do frasco, em 2–10% da tela, nunca tema.
- Archivo variável: nomes em largura 125% e peso 250, rótulos de HUD em largura 112%, caixa alta e tracking 0,18em.
- Controles vazados em pílula com linha de prata; o sotaque aparece no hover e no estado ativo.
- Profundidade por luz, desfoque e escala, não por cartões com sombra.

## Colors

Preto espacial com prata e branco suave; um único sotaque vivo, emprestado do frasco em foco.

### Primary
- **Sotaque do Frasco** (accent, padrão prata fria; reescrito em tempo real como `--accent-rgb`): a cor do perfume selecionado. Deriva em quatro intensidades fixas: cheia (marca do carimbo, sublinhado da aba, anel de foco, cursor de texto), `--accent-line` a 45% (bordas no hover e no estado ativo), `--accent-glow` a 32% (brilhos difusos) e `--accent-soft` a 14% (preenchimento no hover). Na galáxia, entra como uniforme dosado pela saturação.

### Neutral
- **Vazio** (void): o fundo do app e da galáxia; também a cor do texto sobre o botão claro.
- **Vazio Elevado** (void-raised): o fundo das folhas (adicionar, editar).
- **Vidro Escuro** (void-panel): menus flutuantes e toasts, sempre com `backdrop-filter: blur(18px)`.
- **Fio de Prata** (hairline, 9% branco): bordas de repouso de chips e avisos.
- **Fio de Prata Forte** (hairline-strong, 17% branco): bordas de botões, campos, folhas e botões redondos.
- **Branco Suave** (text): nomes, texto principal e o preenchimento do único botão cheio.
- **Cinza Suave** (text-2): metadados da placa, rótulos de controles inativos, corpo de texto secundário.
- **Cinza Distante** (text-3): contadores, rótulos de campo, dicas. Contraste 5,1:1 sobre o Vazio; não clarear nem escurecer além disso sem refazer a conta.
- **Prata** (silver): ícones dos botões redondos e o contorno do glifo do frasco na marca.
- **Rosa Cinzento** (danger): exclusão e erros; nunca como sotaque.

### Named Rules
**The Sotaque, Nunca Tema Rule.** A cor do frasco ocupa no máximo 2–10% da tela. Fundos, superfícies e texto continuam pretos, cinzas e brancos; nenhum componente ganha fundo cheio na cor do sotaque, exceto marcas de 7–16px.

**The Domesticação Rule.** Toda cor extraída passa por `accentFor`: luminosidade 0,68–0,80, croma 0,07–0,145 (multiplicado por 1,15), croma abaixo de 0,035 vira prata (L 0,8, C 0,012). Nunca aplicar a cor crua da foto.

**The Não Recomprar É Prata Rule.** O veredito "Não comprar novamente" nunca usa o sotaque nem o vermelho de perigo: seu carimbo e seu chip ficam em prata (`text-2`, fundo branco a 3–5%).

## Typography

**Display Font:** Archivo Variable (eixos de largura 62–125% e peso 100–900), com Archivo, system-ui
**Body Font:** Archivo Variable em largura normal
**Label/Mono Font:** Archivo Variable em largura 112%; números com `tabular-nums`

**Character:** Uma única família, esticada. Os nomes dos perfumes são largos e ultraleves como placas de personagem; a interface fala em rótulos de HUD largos e espaçados; o corpo volta à largura normal para ser lido.

### Hierarchy
- **Display** (250, `clamp(1.9rem, 1.1rem + 3.4vw, 4.1rem)`, 0,98, largura 125%, caixa alta, `text-wrap: balance`): só o nome do perfume na placa. No celular cai para `clamp(1.55rem, 7.4vw, 2.3rem)` e largura 116%.
- **Title** (300, `clamp(1.25rem, 1rem + 0.8vw, 1.6rem)`, largura 125%, caixa alta): títulos de estados vazios e do pareamento.
- **Body** (400, 15px, 1,45): texto corrido; avisos e dicas limitados a 36–60ch.
- **Body Small** (400, 13px): metadados da placa (marca · concentração · volume · gênero, separados por pontos de 3px), filtros, chips de veredito, dicas.
- **Label** (500, 11px, tracking 0,18em, largura 112%, caixa alta): abas, marca, botões, rótulos de campo, contador, título de folha. Botões de ação sobem o tracking para 0,20–0,26em.
- **Preço** (1.0625rem, largura 105%): o único número de destaque na placa.

### Named Rules
**The Uma Família Rule.** Tudo é Archivo variável; a hierarquia vem de largura, peso e caixa, nunca de uma segunda fonte.

**The Nome Largo e Leve Rule.** O nome do perfume é o único texto em peso abaixo de 300 e largura 125%; nada mais na tela usa essa combinação.

## Layout

Palco em tela cheia, sem rolagem (`body { overflow: hidden }`); a interface vive em faixas fixas nas bordas. O cabeçalho (64px, 56px abaixo de 640px, 48px no celular deitado) é uma grade de três colunas: marca à esquerda, abas no centro, "Adicionar perfume" à direita. Os filtros da coleção ficam numa faixa centralizada logo abaixo. O HUD inferior distribui placa (máx. `min(600px, 44vw)`) à esquerda e navegação à direita. Margens laterais pelo `gutter` fluido (`clamp(16px, 3.2vw, 48px)`) somado às áreas seguras.

O frasco em foco fica centrado com altura `min(58vh, 700px)` (62vh a partir de 1600px), centro vertical em 44% (46% na coleção). Os vizinhos recuam na diagonal com escala `1 / (1 + d^0.9 × 0.62)` e opacidade exponencial; no celular o recuo é mais forte (0,7 e 1,45) para que o vizinho fique claramente secundário.

Celular retrato (≤720px): marca some, abas alinham à esquerda, "Adicionar" vira botão redondo de 44px, filtros rolam na horizontal com máscara nas bordas, frasco em `min(43vh, 118vw, 440px)` (36vh na coleção), contador sobe para o canto superior direito sem setas, placa ocupa a largura e a ação vira faixa de 50px de altura. Celular deitado: placa à esquerda, palco à direita, tudo mais baixo.

Ritmo de espaço em múltiplos de 4px (4, 8, 12, 16, 24, 32, 48, 64). Alvos de toque de pelo menos 40px, 44px no celular.

## Elevation & Depth

Profundidade é luz e distância, não cartões. O palco empilha: galáxia (fundo em gradiente de ruído com nebulosa tingida e estrelas com paralaxe do ponteiro), um cone de luz desfocado (26px) na cor do sotaque descendo sobre o frasco, a poça de luz elíptica no piso com uma linha de horizonte de 1px, o reflexo do frasco espelhado a 30% com máscara curta, e o frasco com sombra projetada. Os vizinhos ganham profundidade por escala, opacidade e rotação em Y. As únicas sombras de caixa ficam nas camadas flutuantes (folha, menu, toast).

### Shadow Vocabulary
- **Sombra do frasco** (`filter: drop-shadow(0 28px 34px rgb(0 0 0 / 0.55))`): toda foto de frasco, no palco e na revisão.
- **Sombra de painel** (`box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.8), 0 1px 0 rgb(255 255 255 / 0.04) inset`): folhas, menu "mais", toast.
- **Brilho de ação** (`box-shadow: 0 10px 30px -12px var(--accent-glow)`): hover da ação principal da placa.
- **Anel suave** (`box-shadow: 0 0 0 3–4px var(--accent-soft)`): foco de campo e hover do botão claro.

### Named Rules
**The Sombra Com Distância Rule.** Toda sombra tem deslocamento e desfoque generosos; nunca halo colado nem sombra dura deslocada.

**The Luz É a Elevação Rule.** No palco, o que está em foco é o que está iluminado: cone, poça e reflexo marcam o selecionado. Não usar moldura, cartão ou fundo para destacar um frasco.

## Shapes

Três formas, com papéis fixos. Controles interativos são pílulas ou círculos vazados (999px) com fio de prata de 1px. Superfícies (folha, menu, campo, aviso) são quase retas (4px); no celular a folha sobe da base com 10px só nos cantos de cima. O carimbo do veredito é o único retângulo de 2px, marcado por cantos em L de 7px deslocados 4px para fora. A seleção do palco (foco de teclado e inspeção) usa o mesmo vocabulário de cantos: oito traços de 1px × 18px na cor do sotaque a 70%. Marcas de estado são losangos (quadrados de 7–8px girados 45°). Os ícones são SVG de traço fino (lucide), nunca glifos.

## Components

### Buttons
Vazados, finos, em pílula; o sotaque só aparece quando a mão chega perto.
- **Shape:** pílula (999px); redondos em círculo de 40–44px.
- **Primário claro** (o único botão cheio): fundo Branco Suave, texto Vazio, peso 650, tracking 0,2em, 46px de altura. Usado só para confirmar dentro da folha ("Adicionar à wishlist"). Hover: branco puro e anel de 4px em `accent-soft`.
- **Ação da placa** ("Comprei"): vazada com fio forte, texto Branco Suave, tracking 0,24em, 46px (50px e largura total no celular), losango de 7px na cor do sotaque à esquerda e dica em corpo pequeno à direita. Hover: borda `accent-line`, fundo `accent-soft`, brilho de ação e losango preenchido.
- **Redondo** (↗ loja, mais opções, setas): círculo vazado, ícone Prata; hover igual ao da ação. Desabilitado a 25%.
- **Adicionar** (cabeçalho): pílula vazada de 40px com ícone + rótulo; no celular vira círculo de 44px só com o ícone.
- **Texto:** sublinhado com fio forte a 5px; hover troca o sublinhado para `accent-line`.

### Chips
- **Veredito:** pílulas de 40px (44px no celular, em grade 2×2) com fio de 9%, marca circular de 16px e texto pequeno Cinza Suave. Ativo: borda `accent-line`, fundo `accent-soft`, marca preenchida no sotaque.
- **Filtros da coleção:** texto pequeno com contador em rótulo; ativo ganha texto Branco Suave e sublinhado `accent-line` de 1px. Sem pílula, sem fundo.

### Cards / Containers
- **Não há cartões.** O frasco repousa direto no espaço.
- **Folha** (adicionar / editar): diálogo nativo sobre véu `rgb(2 2 4 / 0.55)`, fundo Vazio Elevado, fio forte, 4px, sombra de painel, padding 26px; entra subindo 14px com escala 0,985 em 460ms. A versão de revisão tem 880px e duas colunas (frasco sobre sua própria poça de luz à esquerda, campos à direita).
- **Menu e toast:** Vidro Escuro com desfoque de 18px; menu com 4px, toast em pílula.

### Inputs / Fields
- **Style:** 46px (54px no campo principal de link), fundo branco a 3%, fio forte, 4px, texto 16px, cursor na cor do sotaque. Rótulo acima em Label Cinza Distante. Selects com seta desenhada em gradiente.
- **Focus:** borda `accent-line` e anel de 3px em `accent-soft`.
- **Error:** borda Rosa Cinzento a 60%; mensagem em corpo pequeno Rosa Cinzento.

### Navigation
- **Abas** (Wishlist / Coleção): rótulos com tracking 0,22em e contador; inativa Cinza Distante, hover Cinza Suave, ativa Branco Suave com sublinhado de 1px no sotaque que cresce do centro (`scaleX`). Ao chegar um frasco na coleção, o contador pulsa no sotaque.
- **Contador do elenco:** "01 / 14" em Label com números tabulares, atual em Branco Suave; setas redondas ao lado (somem no celular retrato).

### Carimbo do Veredito (assinatura)
O veredito em repouso: palavra em largura 125%, 13px, peso 500, tracking 0,2em, na cor do sotaque, dentro de um quadro de 2px com fio `accent-line`, fundo em gradiente horizontal do sotaque (12% → 3%), losango cheio de 8px com brilho e dois cantos em L. Recém-escolhido, entra "carimbado": escala 1,18 e giro de −2° até assentar em 620ms.

### Palco (assinatura)
Posição contínua, não lista: arrastar, rolar ou setas movem um número real e uma mola leva ao frasco mais próximo. Tocar no frasco em foco (ou no botão "Perfil olfativo" da placa) abre o close-up: cabeçalho, filtros e HUD somem, os vizinhos se apagam por completo, o frasco desliza 17% da largura para a esquerda (no celular: sobe 12% da altura e encolhe 30%), cone, poça e foco da galáxia vão junto; arrastar inclina em perspectiva, pinça/roda aproxima. Comprar faz o frasco subir, acender e se dissolver (720ms) com um anel de luz no piso.

Todo frasco chega num quadro quadrado padrão (`src/core/canvas.ts`: PNG mestre 2048², fundo transparente, frasco em até 72% × 84%, centrado, base na linha de 92%). No palco o quadro é desenhado com lado `--bottle-h / 0.84` e descido 8% dele: o frasco mais alto ocupa exatamente `--bottle-h`, toda base pousa no mesmo piso, e o reflexo espelha sobre a linha de 92% (`transform-origin: 50% 92%`), não sobre a borda do arquivo. Recortes antigos, justos, são detectados pela proporção da imagem e seguem o caminho anterior.

### Pirâmide Olfativa (close-up)
Sem painel: texto direto sobre o espaço, à direita no desktop (até 460px ou 36vw), numa folha que sobe do rodapé no celular (55dvh, gradiente do preto a partir de 44px, rolável). Nome em Display reduzido (clamp 1,5–2,3rem), ficha técnica abaixo. "Perfil olfativo" em Label espaçado 0,3em. Três camadas centradas — **Saída**, **Coração**, **Fundo** — cada uma sob um fio de luz (gradiente transparente → `accent-line` → `accent` → transparente) de largura crescente 38% / 68% / 100%: a silhueta da pirâmide vem das linhas. Nome da camada em Label largura 125%, peso 600, na cor do sotaque, com uma legenda curta em Cinza Distante; notas em 16px peso 350, separadas por losangos de 4px do sotaque a 55%. Acordes em linha, na ordem da fonte, sem barras nem porcentagens. Perfumista / Lançamento / Família como pares Label + valor. Rodapé com as fontes citadas (links sublinhados em `line-strong`) e "Pesquisar de novo" quando há servidor. Entrada orquestrada: painel desliza 18px (620ms, atraso 120ms); cada fio se desenha do centro (820ms, atraso 360 + 170·camada ms) e o texto da camada sobe 8px com desfoque de 2px logo depois. Notas aparecem em português quando há tradução consagrada; o dado guardado fica no idioma da fonte.

### Prévia de Importação
Adicionar é só isto: título "ADICIONAR PERFUME", rótulo "Cole o link do perfume", o campo e um botão largo "ADICIONAR PERFUME". Depois de colar: sete marcas de 18×1px acendem uma a uma sob a frase da etapa — IDENTIFICANDO PERFUME → ANALISANDO O LINK → PESQUISANDO O PRODUTO → ENCONTRANDO A MELHOR IMAGEM → PREPARANDO O FRASCO → ANALISANDO O PERFIL OLFATIVO → FINALIZANDO — e as etapas nunca voltam. Se a loja não deixa ler, a frase vira "Buscando o produto em outras fontes…" (nunca um erro). Identidade confirmada: o perfume entra direto na wishlist, com a animação de chegada e o aviso. Confiança moderada: prévia com "É este o perfume?" em Label no sotaque, o frasco no quadro quadrado, ficha, preço e as três camadas — "Adicionar à wishlist" como ação primária, "Não é este" e "Corrigir dados" como texto. Nada seguro: "Não conseguimos identificar este perfume com segurança." + [Tentar novamente] + uma única pergunta, "Qual perfume é este?" (marca e nome num campo só).

## Do's and Don'ts

### Do:
- **Do** derivar toda cor de interação das quatro intensidades do sotaque (`accent`, `accent-line` 45%, `accent-glow` 32%, `accent-soft` 14%).
- **Do** transicionar com `cubic-bezier(0.16, 1, 0.3, 1)` e as durações 160 / 320 / 700 / 1200ms; com `prefers-reduced-motion`, cair para 1 / 120 / 160 / 200ms e trocar voos por esmaecimentos.
- **Do** manter o texto nos três tons (Branco Suave, Cinza Suave, Cinza Distante) e o foco visível como contorno de 1px no sotaque com 3px de afastamento.
- **Do** dar a todo frasco a sombra do frasco e, no palco, cone, poça e reflexo.
- **Do** escrever rótulos de HUD em Label (11px, 0,18em, largura 112%, caixa alta).

### Don't:
- **Don't** usar cartões, grades de produto ou painéis opacos no palco.
- **Don't** pintar fundos, superfícies ou texto corrido com a cor do sotaque, nem usar a cor crua extraída da foto.
- **Don't** usar estrelas ou notas numéricas para o veredito; são quatro palavras em português.
- **Don't** usar sombras duras deslocadas ou halos colados.
- **Don't** introduzir uma segunda família tipográfica nem ícones em glifo; ícones são SVG de traço fino.
- **Don't** dar ao "Não comprar novamente" o sotaque ou o vermelho de perigo.
- **Don't** mostrar porcentagens, barras de intensidade ou ícones de ingrediente nas notas; a hierarquia da pirâmide é a estrutura, não um número inventado.

## Disciplina de interface (passe HIG, 27/09/2026)

- **Alvo de toque**: `--target: 44px` em ponteiro grosso (`@media (pointer: coarse)`, no fim do app.css para vencer as regras de desenho) — botões redondos, "Perfil olfativo", filtros e botões de texto. No mouse ficam os 40px desenhados. O smoke mede todo controle visível no celular.
- **Foco**: anel `--focus-ring: 2px` na cor do sotaque, `--focus-offset: 3px`, seguindo o raio do controle.
- **Destrutivo = desfazer**: "Remover" (já com confirmação no menu) tira o perfume da tela na hora e mostra "Desfazer"; a remoção só vai para o armazenamento quando o aviso expira, é substituído, ou a página é fechada (`pagehide`). Trocar de aba não apaga.
- **Avisos**: o tempo para com o ponteiro ou o foco em cima (dá para ler e alcançar a ação).
- **Listas com separador** (meta da placa, do close-up, da prévia e notas da pirâmide): flex com `column-gap` igual à pegada do separador; o separador é absoluto, centrado no vão, e o item que começa linha (`data-line-start`, medido em `src/lib/wrap.tsx`) não mostra o dele — nunca "• Unissex" solto, e sem vaivém de quebra.
- **Filtros no celular**: a barra rola; o filtro ativo (inclusive quando muda sozinho ao trocar o veredito) é trazido à vista; cada filtro anuncia "Muito bom: 1 perfume".
- **Palco no celular**: frasco `min(47vh, 118vw, 470px)` (coleção 39vh); em telas baixas (≤720px) 43vh/35vh para não encostar no contador.
