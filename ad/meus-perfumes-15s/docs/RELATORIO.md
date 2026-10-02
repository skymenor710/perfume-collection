# Relatório — anúncio "Do link ao universo" (15 s)

## A ideia, em uma frase

**Um link vira um perfume; o perfume vira um universo; o universo é a sua coleção.** Em 15 segundos, sem narração:
o gancho mostra o recurso mais mágico do app (colar um link e ver o frasco se materializar), o meio vende o desejo (a
tela de seleção em que o espaço muda de cor a cada frasco) e o fim entrega controle (Comprei → Coleção → veredito)
antes da marca.

## Por que funciona

- **O gancho é uma transformação, não um logo.** Quadro 0: o link real em tipografia gigante, nítido, com a interface
  desfocada em volta e uma varredura de luz — algo legível e estranho o bastante para parar o dedo. Meio segundo depois
  a câmera recua (é o app), o botão acende, é tocado, as letras viram fios de luz, desenham a silhueta do frasco (o
  glifo real do app), as sete etapas reais da análise piscam e — bum — o frasco azul se materializa e o espaço
  inteiro acende. Em 1,5 s o espectador já viu o que o produto faz.
- **Produto real, com direção de arte.** Frascos, dados, textos, fonte, tokens, curvas de animação (`cubic-bezier(0.16,
  1, 0.3, 1)`), o "arrive", o "depart", o anel de luz no piso, o carimbo do veredito e até o shader da galáxia são os
  do app. O anúncio não finge uma interface: ele encena a que existe.
- **A pirâmide olfativa desenhada sobre o próprio frasco** (saída na tampa, coração no corpo, fundo na base) transforma
  dados em imagem — a "tela de status" de um personagem, coerente com a metáfora de seleção de personagem do app.
- **A cor como ritmo.** Na montagem, cada frasco que entra em foco repinta o universo e toca uma nota de vidro: a
  interface vira música (lá menor pentatônico sobre Am9 → Fmaj9 → Cmaj7 → Gadd9).
- **Pouco texto.** Só o que a interface já diz, e uma frase de marca: *Toda coleção merece um universo.*

## Decisões de direção

- **Sem narração:** voz sintética empobreceria o luxo; o feed assiste sem som na primeira volta — imagem e texto contam
  a história sozinhos; com som, o sound design conduz.
- **Paleta:** a do app (preto espacial, prata, um sotaque vivo por frasco), com uma licença: a nebulosa acende mais
  forte que no uso diário.
- **Herói:** French Avenue Azzure Aoud — o frasco da coleção que entrou de verdade pelo link (notino.fr, loja que
  bloqueia leitura; o app foi buscar em outras fontes). O link mostrado é o link real dele.
- **Honestidade:** notas, preços, nomes, contadores (Wishlist 15 → 14, Coleção 0 → 1, filtro "Comprar novamente"
  0 → 1) e a ordem das etapas são os do app. Duas curadorias do anúncio:
  - a ordem dos frascos na montagem (cores em contraste);
  - a pirâmide mostra 7 das 10 notas reais do Azzure Aoud. Ficaram fora "Passion fruit" (sem tradução no app,
    pareceria erro), "Patchouli" (ritmo 2-2-3 dos degraus) e "Esteva" (nome pouco conhecido).

  Nada foi inventado.
- **Adaptação:** conteúdo-chave no quadrado central; áreas de interface do Reels/TikTok livres.

## Som

Sintetizado do zero (`audio/synth.mjs`), sem samples de terceiros:
- vidro modal (parciais de uma taça, com batimento) como instrumento principal — 30 notas ao longo do filme;
- pulso a 120 BPM (bumbo com harmônicos, hats de vidro, estalo nos contratempos), baixo em colcheias, pads;
- colar (plop), varredura (grãos de vidro esquerda → direita), recuo (sopro), toque (clique), redemoinho (ruído rosa
  girando no estéreo), ticks das etapas subindo, varredura descendo, reverse-cymbal, **impacto** (sub com oitava e
  saturação + acorde de vidro + ar), zips de luz da pirâmide, sopros da montagem, rebobinada com vidro ao contrário,
  pouso, confirmação, subida do "Comprei", faíscas, pulso da aba, carimbo, reverso até o **acorde final**, arpejo da
  tampa;
- reverb Freeverb longo (o "espaço"), compressão de barramento suave, master a -14 LUFS / pico real ≤ -1 dBTP.

## QA do filme final (medido no MP4 entregue)

**Arquivo**
- 1080 × 1920 (9:16, SAR 1:1), 30 qps, 450 quadros, 15,0 s.
- Vídeo: H.264 High 4.2, yuv420p BT.709, ~10 Mb/s.
- Áudio: AAC-LC 48 kHz estéreo, 320 kb/s. A versão sem áudio tem o mesmo vídeo, quadro a quadro.

**Áudio**
- Loudness: **-14,1 LUFS** integrados, pico real **-1,5 dBTP**, LRA 2,1 LU.
- Medido no MP4, depois do AAC: o codificador não empurrou o pico.

**Sincronia A/V**, ataque do som contra o evento visual:

| Evento | Esperado | Áudio | Vídeo |
|---|---|---|---|
| Impacto | 1,500 s | 1,508 s | salto de luz no quadro 45 (1,500 s) |
| Pouso | 9,000 s | 9,004 s | — |
| Comprei | 9,500 s | 9,508 s | quadro 285 (9,500 s) |
| Carimbo | 11,000 s | 11,004 s | — |
| Acorde final | 12,500 s | 12,506 s | — |

Tudo dentro de +8 ms, bem abaixo do perceptível (~±20–45 ms).

**Revisão visual**
- Mosaicos a cada 0,1 s (`out/qa/mosaico_1..3.png`).
- Folhas quadro a quadro das transições críticas: gancho, primeira troca, rebobinada, partida e luz → tampa.

**Ortografia**
- Todo texto de interface é a string real do app, em PT-BR.
- A frase da marca foi conferida.
- Preços no formato do app (€ 49,90).

**Problemas achados no QA do filme e corrigidos, com novo render**

| # | Problema | Correção |
|---|---|---|
| 1 | Recuo de câmera (0,2–0,3 s) em 3 cópias nítidas empilhadas: 3 amostras por quadro não dão conta de um whip-zoom. | Desfoque de movimento adaptativo (`tools/motionblur.mjs`): mede o deslocamento entre subquadros e dá até 48 amostras aos quadros rápidos. 114 quadros ganharam amostras extras (1044 subquadros): recuo, trocas, rebobinada, mergulho do outro e contração da luz. |
| 2 | A montagem não mudava de cor: com trocas a cada 0,5 → 0,125 s, a perseguição de cor do app (τ 0,45 s) deixava o universo sempre a meio caminho entre dois sotaques, um cinza. | τ 0,1 s na montagem e ganho da nebulosa 4,2. Agora: verde-oliva no Elite, malva no Ateeq, azul-petróleo no Island, ouro no Cedrus. |
| 3 | A luz virava a tampa com um salto de elipse para retângulo, em um quadro. | Morfe contínuo em superelipse: o gradiente alcança os cantos antes de o raio encolher. |
| 4 | O botão Comprei "destocava" (losango vazio) enquanto sumia. | Fica ativo até sumir, como no app. |

Rodadas de QA anteriores, sobre os rascunhos, também corrigiram:
- gancho digitado ilegível → link colado em close fixo;
- partículas "cabeludas";
- fios da pirâmide invisíveis;
- faíscas parecendo arranhões;
- frasco da Coleção sobre os filtros;
- mancha clara no botão desabilitado;
- inundação verde-menta;
- HUD vazando na cartela;
- sotaque preso no prata;
- mixagem: gancho baixo demais, riser inaudível, pouso indistinto, reverb seco.

## Arquivos

| O quê | Onde (em `ad/meus-perfumes-15s/`) |
|---|---|
| Vídeo final | `out/meus-perfumes-ad-15s.mp4` |
| Sem áudio | `out/meus-perfumes-ad-15s-sem-audio.mp4` |
| Capa | `out/capa.png` (4,0 s) |
| Música | `audio/out/musica.wav` |
| Efeitos | `audio/out/efeitos.wav` |
| Mix masterizado | `audio/out/mix-master.wav` |
| Assets | `src/` (compositor, timeline, dados, 15 frascos, fonte, shaders); `tools/` (render, desfoque, master, encode) |
| Conceito | `docs/CONCEITOS.md` |
| Storyboard | `docs/STORYBOARD.md` |
| QA | `out/qa/` (mosaicos, nível e espectrograma do áudio) |

Os intermediários de render (`frames/`, `frames-mb/`, `frames30/`, ~4,8 GB de PNG) foram apagados depois da
codificação. São regeneráveis pelo `README.md` em ~25 min.

## Garantias

- **App de produção não alterado.** O anúncio só lê: nenhum arquivo de `apps/`, `packages/`, `scripts/`, `tests/`
  ou `docs/` do produto foi modificado. Tudo novo está em `ad/meus-perfumes-15s/`.
  - `git status`: só `?? ad/`; `git diff HEAD` vazio; HEAD segue em `280e327`.
  - Checagem do app no ar (:3100): 7/7. API byte a byte igual ao baseline, 32/32 imagens com o mesmo SHA-256.
- **Neon, R2 e banco não alterados.** Os dados vieram por `GET /api/perfumes` do app local, só leitura; nada foi
  gravado. Não houve acesso à Cloudflare.
  - O `.env.local` está intocado desde 28/09 e não tem nenhuma variável R2/MEDIA.
  - O único arquivo do app com data de hoje é `data/storage-backend.json`. Nele, o servidor regrava `confirmedAt`
    a cada partida (`official-source.ts`). A partida foi às 21:48, no fechamento da FASE 3.0, antes deste trabalho.
- **Sem deploy, sem commit, sem push.** A pasta `ad/` não está no Git.
