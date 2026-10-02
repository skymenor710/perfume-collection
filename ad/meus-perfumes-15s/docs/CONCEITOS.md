# Meus Perfumes — anúncio de 15 s · conceitos

## O que a varredura revelou (e que vira anúncio)

- **O produto não é uma lista: é uma "tela de seleção de personagem no espaço".** Um frasco sozinho numa poça de luz,
  o resto do elenco recuando em diagonal para a escuridão (DESIGN.md, "A Tela de Seleção no Espaço").
- **O universo muda de cor com o frasco.** A galáxia WebGL do app é tingida pela cor extraída da foto de cada
  perfume (Azzure Aoud → azul `#7497de`, Club de Nuit Elite → lima `#99b039`, Ateeq → terracota `#c8847b`,
  Island Dreams → turquesa `#58a4bc`, Cedrus Blanc → ouro `#dab771`…). É a assinatura visual — e é real.
- **Adicionar é só colar um link.** O servidor identifica o perfume, acha a melhor foto, recorta o frasco, extrai a
  cor e pesquisa a pirâmide olfativa — em sete etapas que o app mostra ("IDENTIFICANDO PERFUME → … → FINALIZANDO").
  O Azzure Aoud da coleção entrou exatamente assim, a partir de um link da notino.fr (que bloqueia leitura: o app
  foi buscar em outras fontes).
- **Wishlist → "Comprei" → Coleção → veredito carimbado** ("Comprar novamente", "Muito bom"…; nunca estrelas).
- **Identidade:** preto profundo, prata, uma única cor viva emprestada do frasco; Archivo variável esticada (nomes em
  largura 125%, peso 250); fios de luz de 1 px; pílulas vazadas; movimento `cubic-bezier(0.16, 1, 0.3, 1)`;
  chegada do frasco saindo de um desfoque luminoso; anel de luz no piso; linha de varredura na análise.
- **Material real disponível:** 16 mestres PNG 2048² com fundo transparente (frascos reais da coleção), a fonte, os
  tokens, o shader da galáxia, os textos reais da interface e os dados reais (nomes, notas, preços, links).

## Conceito 1 — "Do link ao universo"  ✅ escolhido

- **Hook (0–1,5 s):** um link gigante atravessa a tela em tipografia larga, como se passasse rente à câmera; a câmera
  recua e revela que ele está no campo do app ("COLE O LINK DO PERFUME"). Toque em "Adicionar perfume": as letras se
  soltam, viram faíscas, giram e desenham a silhueta do frasco (o glifo real do app); a linha de varredura desce;
  as sete etapas piscam. **Bum:** o frasco azul de verdade se materializa e o espaço inteiro acende em azul.
- **Narrativa:** um link → um perfume completo → uma coleção inteira → a sua coleção.
- **Motion principal:** partículas que obedecem à tipografia; materialização (o "arrive" do app, ampliado); o frasco
  vira um "personagem" com seus atributos: a pirâmide olfativa desenhada SOBRE o próprio frasco (saída na tampa,
  coração no corpo, fundo na base); recuo de câmera que revela a tela de seleção; carrossel acelerando com o
  universo trocando de cor a cada batida; "Comprei" com o frasco subindo e se dissolvendo rumo à Coleção; carimbo
  do veredito; a marca com a tampa do glifo trocando de cor.
- **UI:** o campo de link, as etapas, a placa com o nome, a pirâmide, abas, contador, "Comprei", carimbo e a marca —
  com a fonte, os tokens, os textos e as durações reais do app.
- **Imagens:** os mestres reais dos frascos (sem estoque, sem IA).
- **Música:** pulso eletrônico mínimo a 120 BPM, em lá menor, com pad escuro; entra de verdade quando a coleção
  aparece.
- **Sound design:** teclas, clique de UI, sucção reversa, impacto grave + campainha de vidro na materialização,
  "zips" de luz nas linhas da pirâmide, e **cada frasco que entra em foco toca uma nota de vidro** — a troca de cores
  vira melodia.
- **Final:** glifo do frasco se desenhando; a tampa percorre as cores da coleção; "MEUS PERFUMES"; "Toda coleção
  merece um universo."
- **Por que funciona:** o gancho é uma transformação inesperada (texto que vira objeto) e já demonstra o recurso mais
  mágico do produto; o meio vende o desejo (o universo que muda de cor); o fim entrega controle (comprei → coleção →
  veredito). Tudo é o produto real, com direção de arte — não uma sequência de prints.

## Conceito 2 — "Cromático"

- **Hook:** preto absoluto; um único "tim" de vidro; um frasco cai numa poça de luz e o universo floresce na cor dele.
- **Narrativa:** frasco após frasco pousa no mesmo ponto, cada um repintando o espaço, cada vez mais rápido, até a
  câmera recuar e mostrar a coleção inteira na diagonal. "Cada perfume tem uma cor. A sua coleção, um universo."
- **Motion:** cortes na batida, flashes de cor, poças de luz, reflexos; cartela final com o glifo.
- **UI:** mínima (placa com o nome); **imagens:** os mestres reais.
- **Música/sound:** o "tim" de vidro como instrumento principal; batida que acelera.
- **Final:** marca + frase.
- **Por que (não) escolhido:** hipnótico e belíssimo, mas não diz o que o app FAZ — pode ser confundido com anúncio
  de perfume. Virou o ato 3 do conceito 1.

## Conceito 3 — "Da planilha à constelação"

- **Hook:** uma bagunça de abas de lojas, prints, preços e uma planilha "Lista de Perfumes" (a origem real da coleção)
  voando na tela.
- **Narrativa:** um pulso magnético: linhas da planilha viram frascos, frascos viram estrelas, tudo se alinha na
  tela de seleção.
- **Motion:** caos → ordem; magnetismo; linhas virando constelações.
- **UI/imagens:** exigiria fabricar prints de lojas e de planilha.
- **Música/sound:** ruído denso que colapsa num acorde limpo.
- **Final:** marca.
- **Por que não:** "caos que vira ordem" é clichê de template, o caos exigiria material falso de terceiros, e a
  estética contradiz o minimalismo da marca.

## Decisões de direção

- **Sem narração.** O produto fala por movimento e som; voz sintética empobreceria o luxo, e o público-alvo do feed
  assiste sem som na primeira volta — o texto na tela e a imagem contam a história sozinhos.
- **Texto:** só o que a interface já diz, mais uma frase de marca no fim. Nada de apresentação.
- **Paleta:** a do app, com uma licença: o universo acende com mais intensidade do que no uso diário (é anúncio).
- **Formato:** 9:16, 1080 × 1920, 15 s. O conteúdo-chave vive no quadrado central (y 420–1500) e as áreas de interface
  do Reels/TikTok (topo ~220 px, base ~380 px, coluna direita) ficam livres de informação essencial — adaptável para
  1:1 e 16:9 recompondo o HUD.
- **Honestidade:** o link mostrado é o link real do frasco mostrado; notas, preço e nomes são os da coleção.
