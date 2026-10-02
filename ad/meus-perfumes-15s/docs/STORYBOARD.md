# Storyboard — "Do link ao universo" (15 s · 9:16 · 1080 × 1920 · 120 BPM, lá menor)

Esta é a versão final, a que foi renderizada. A fonte única dos tempos é `src/timeline.js`, lida pelo vídeo e pelo
áudio: a sincronia vem da construção.

Grade musical: 1 batida = 0,5 s. Easings do app:
- `cubic-bezier(0.16, 1, 0.3, 1)` ("ease-out do app");
- `cubic-bezier(0.65, 0, 0.35, 1)` ("in-out do app").

Coordenadas em px no quadro 1080 × 1920; a UI está em escala 2,7× do CSS real, o tamanho que ela tem num celular.

Cada quadro é função do tempo `t` (render determinístico). Desfoque de movimento com obturador de 270°: média de 3 a
48 instantes por quadro, conforme a velocidade medida.

Áreas seguras de Reels/TikTok: nada essencial acima de y ≈ 200 (exceto as abas, que são a interface), abaixo de
y ≈ 1520 ou na coluna x > 960 entre y 800–1500.

## Ato 1 — Gancho: o link (0,00–1,50)

| t | Visual e posição | Movimento / easing | Texto | Câmera / efeito | Áudio |
|---|---|---|---|---|---|
| **0,00** | Close de 3,75× no campo de link da folha "Adicionar perfume" do app: o slug do link real em letras gigantes, nítido; interface desfocada em volta (3,2 px) | texto "colado" de uma vez: pop de escala 1,07 → 1 (0,16 s) com brilho 26 → 0 px; uma faixa de luz varre da esquerda para a direita (0–0,32 s) | `…/french-avenue/azzure-aoud-eau-de-parfum-pour-homme/` (link real do frasco, notino.fr) | push-in lento 3,75 → 3,5× com deriva lateral | "plop" de colar; 18 grãos de vidro seguindo a varredura (esq. → dir.); drone grave (lá + mi) abrindo o filtro |
| **0,20–0,56** | Revela a folha inteira: título, rótulo, campo, botão | **recuo de câmera** 3,5 → 1× (expo-out, 0,36 s); desfoque de foco 2,6 → 0 | ADICIONAR PERFUME · COLE O LINK DO PERFUME | whip-zoom com desfoque de movimento de 24–48 amostras | whoosh de recuo |
| **0,30–0,44** | O botão, apagado (34%), acende: o link é válido, como no app | fade do fundo do botão (ease-out) | botão ADICIONAR PERFUME | — | tick do botão (0,42) |
| **0,60** | Toque no botão | ripple circular + brilho | — | brilho de toque (tela) | clique de UI |
| **0,66–1,36** | As letras do link, a pílula do botão e as bordas da folha viram fios de luz, da direita para a esquerda | cada partícula gira em torno do centro da silhueta (polar) e pousa num ponto do contorno do glifo do app; rastros curvos afinados | etapas reais da análise, 0,1 s cada: IDENTIFICANDO PERFUME… · ANALISANDO O LINK… · PESQUISANDO O PRODUTO… · ENCONTRANDO A MELHOR IMAGEM… · PREPARANDO O FRASCO… · ANALISANDO O PERFIL OLFATIVO… · FINALIZANDO…; 7 marcas acendendo | folha: desfoque 0 → 14 px e fade | redemoinho (ruído rosa girando no estéreo); 7 ticks subindo |
| **0,98–1,34** | A silhueta do app (tampa + corpo) se fecha em prata | traço desenhando (in-out) | — | — | — |
| **1,08–1,45** | Linha de varredura do app desce pela silhueta | in-out, 0,37 s | — | — | varredura descendo; reverse-cymbal e riser até o impacto |

## Ato 2 — O perfume completo (1,50–5,00)

| t | Visual e posição | Movimento / easing | Texto | Câmera / efeito | Áudio |
|---|---|---|---|---|---|
| **1,50** | **Materialização** do Azzure Aoud real (900 px, base em y 1180) | "arrive" do app ampliado: desfoque → 0, brilho → 1, escala → 1, subida; as partículas explodem para fora | — | **flash** + risco anamórfico; anel de luz no piso; a galáxia acende em azul `#7497de` (ganho 3,6 → 1,7) | **IMPACTO**: sub com oitava e saturação, ar, acorde de vidro (lá menor add9), faíscas caindo |
| **1,50–2,40** | Palco do app: cone de luz, poça elíptica, horizonte de 1 px, reflexo; o frasco flutua ±11 px | — | — | — | pad Am9; bumbos de meio tempo |
| **2,00** | Nome em Display do app (Archivo 125% de largura, peso 250), y 1150 | letras sobem do desfoque, escalonadas; tracking 0,34 → 0,015 em | **AZZURE AOUD** | — | whoosh curto + ticks |
| **2,25** | Ficha em cinza suave | sobe + fade | French Avenue · Eau de Parfum · 100 ml | — | — |
| **2,50** | **Pirâmide sobre o frasco — Saída na tampa**: fio de luz no sotaque, 560 px, y 355 | fio nasce do centro (scaleX), rótulo e notas sobem ("tier-in" do app) | SAÍDA · a primeira impressão — Açafrão / Rosa | leve inclinação 3D | zip de luz + vidro **A4** |
| **3,00** | **Coração no corpo** (fio de 800 px, y 760) | idem | CORAÇÃO · o corpo do perfume — Oud / Benjoim | — | zip + vidro **C5** |
| **3,50** | **Fundo na base** (fio de 1000 px, y 1115) | idem | FUNDO · o que fica na pele — Couro / Âmbar / Baunilha | — | zip + vidro **E5** |
| **3,50–4,45** | O frasco "com atributos", como a tela de status de um personagem (é a capa, em 4,0 s) | respiração | — | — | pad |
| **4,45–4,95** | Saída: pirâmide e placa se apagam, o frasco recua ao tamanho do palco | in-out do app | — | — | riser + reverse-cymbal até 5,0 |

## Ato 3 — O universo (5,00–9,50)

| t | Visual e posição | Movimento / easing | Texto | Câmera / efeito | Áudio |
|---|---|---|---|---|---|
| **5,00** | A **tela de seleção real**: frasco em foco (700 px, base y 1070), vizinhos na diagonal com a fórmula do app (x = ±0,46·W·\|d\|^0,78; y = d·0,075·H; escala 1/(1+\|d\|^0,9·0,7); giro −9°/posição) | HUD entra: abas, contador, placa, "Comprei" | WISHLIST 15 · COLEÇÃO 0 · 01 / 15 · AZZURE AOUD · French Avenue · Eau de Parfum · 100 ml · Masculino · € 49,90 · ◇ COMPREI | a galáxia sobe para ganho 4,2 | **a batida entra**: bumbo, baixo em colcheias, hats de vidro, estalos nos contratempos; Am9 → Fmaj9 → Cmaj7 → Gadd9 |
| **5,50** | → **Club de Nuit Elite**; o universo fica verde-oliva | posição com a mola do app (rigidez 180, amortecimento 25); a placa troca ("plate-in"); a cor persegue o frasco em OKLab com τ 0,1 s (licença do anúncio: o app usa 0,45 s) | CLUB DE NUIT ELITE · Armaf · Eau de Parfum · 105 ml · € 50,00 · 02 / 15 | estrelas deslizam com o carrossel; o losango do Comprei e o sublinhado da aba mudam de cor | whoosh + vidro **A4** |
| **6,00** | → **Ateeq** (malva) | idem | ATEEQ · Nusuk · Parfum · 100 ml · Masculino · € 29,99 | — | vidro **C5** |
| **6,50** | → **Island Dreams** (azul-petróleo) | idem | ISLAND DREAMS · Khadlaj · Extrait de Parfum · 100 ml · Unissex · € 37,00 | — | vidro **E5** |
| **7,00** | → **Cedrus Blanc** (ouro) | idem | CEDRUS BLANC · Rayhaan · Eau de Parfum · 100 ml · Unissex · € 40,00 | — | vidro **D5** |
| **7,25–8,50** | Aceleração em semicolcheias: **Spectre Ghost**, **9 PM Night Out**, **Empire**, **Supremacy In Heaven**, **Club de Nuit Precieux**, **Vanguard** (os últimos têm sotaque prata no app: o universo esfria) | trocas a cada 0,25 s e depois 0,125 s | nomes, fichas e preços reais | desfoque de movimento nos frascos | hats em semicolcheias; melodia de vidro subindo e virando (E5 G5 A5 C6 E6 D6 C6) |
| **8,50–9,00** | **Rebobinada**: o carrossel volta de uma vez ao Azzure Aoud | a mesma mola, 11 posições | nomes passando ao contrário até AZZURE AOUD · 01 / 15 | desfoque de movimento forte; o universo volta ao azul | whoosh descendente + vidro ao contrário → pouso (baque + vidro A3, 9,0) |

## Ato 4 — Comprei (9,50–12,50)

| t | Visual e posição | Movimento / easing | Texto | Câmera / efeito | Áudio |
|---|---|---|---|---|---|
| **9,50** | Toque no "◇ COMPREI" (y 1392) | estado ativo do app (losango cheio, fundo no sotaque) + ripple | ◆ COMPREI | brilho de toque | clique + vidro E5/A5 |
| **9,62–10,34** | **"depart" do app**: o frasco sobe, acende e se desfaz em faíscas que voam em curva até a aba COLEÇÃO | in-out do app; anel de luz no piso | — | cometas com cauda curta | arpejo de vidro subindo + whoosh + whomp; ticks das faíscas |
| **10,30** | As abas contam: **WISHLIST 15 → 14**, **COLEÇÃO 0 → 1** | count-pulse do app | WISHLIST 14 · COLEÇÃO 1 | brilho na aba | whomp + vidro E6 |
| **10,45** | Toque na aba Coleção; o sublinhado desliza | 0,32 s | — | ripple da aba | clique |
| **10,55** | Vista Coleção: filtros do app; o frasco **chega** ("arrive") | ease-out do app | Todos 1 · Comprar novamente · Muito bom · Bom | anel de luz no piso | vidro ao contrário + whomp + C5 |
| **10,85** | Rótulo do veredito | fade | SEU VEREDITO | — | — |
| **11,00** | **Carimbo do veredito** (assinatura do app) | escala 1,18 → 0,98 → 1, giro −2° → 0, anel de luz | ◆ COMPRAR NOVAMENTE | — | **STAMP** (baque grave + clique) |
| **11,00–11,90** | Leitura: o veredito fica em cena ~0,9 s | — | — | — | groove mais baixo |
| **11,90–12,50** | O mundo mergulha no frasco: push-in + desfoque 0 → 18 px; a luz azul cresce e enche a tela | ease-out | — | — | reverse-cymbal, riser, whoosh, acorde ao contrário |

## Ato 5 — Marca (12,50–15,00)

| t | Visual e posição | Movimento / easing | Texto | Câmera / efeito | Áudio |
|---|---|---|---|---|---|
| **12,50–12,84** | A luz azul **se contrai até virar a tampa** do glifo da marca (130 × 104 px, y 570) | contração in-out; na reta final o círculo vira quadrado arredondado e depois a tampa (superelipse contínua) | — | galáxia com ganho 2,6 | **ACORDE FINAL**: boom, ar, acorde de vidro, pad |
| **12,80–13,28** | Glifo do app: corpo do frasco em contorno prata (234 × 338 px) se desenha | traço (in-out) | — | — | — |
| **12,86–13,76** | A tampa percorre as cores da coleção (Elite, Ateeq, Island, Cedrus, Spectre) e volta ao azul | 6 trocas de 0,15 s; galáxia acompanha | — | — | arpejo de vidro E6 D6 C6 A5 G5 A5 |
| **12,90** | Wordmark, y 1118 | letra a letra (35 ms), desfoque 6 → 0, tracking 0,55 → 0,3 em | **MEUS PERFUMES** | piso: poça, horizonte e reflexo do glifo (13,0–13,6) | whoosh |
| **13,40** | Frase, y 1218 | sobe 20 px + desfoque 6 → 0 (0,6 s) | *Toda coleção merece um universo.* | — | vidro |
| **13,80–15,00** | Cartela final parada; de 14,2 s em diante o brilho da tampa respira (serve de loop) | — | — | — | cauda de reverb |
