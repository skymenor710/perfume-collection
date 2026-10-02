# Meus Perfumes — anúncio de 15 s ("Do link ao universo")

Pasta de produção isolada. **Nada aqui altera o app**: o anúncio só LÊ o projeto (fonte, tokens, shader da galáxia,
mestres dos frascos, textos da interface) e os dados da coleção pela API local (GET).

## Entregas (`out/`)

| Arquivo | O que é |
|---|---|
| `meus-perfumes-ad-15s.mp4` | Filme final: 1080×1920 (9:16), 15 s, 30 qps, H.264 High, AAC 320 kb/s 48 kHz, -14 LUFS |
| `meus-perfumes-ad-15s-sem-audio.mp4` | O mesmo, sem áudio |
| `capa.png` | Capa/thumbnail (4,0 s: o frasco com a pirâmide olfativa) |
| `qa/` | Mosaicos de QA (quadro a cada 0,1 s), nível e espectrograma do áudio |

Áudio (`audio/out/`): `mix-master.wav` (master, PCM 24 bits), `musica.wav` (pad, baixo, bateria, melodia de vidro),
`efeitos.wav` (sound design), `mix-pre-master.wav`.

Documentos (`docs/`): `CONCEITOS.md` (3 conceitos e a escolha), `STORYBOARD.md` (roteiro quadro a quadro),
`RELATORIO.md` (a ideia, decisões e QA).

## Como foi feito (e como refazer)

Tudo é gerado por código, de forma determinística (o mesmo resultado a cada execução):

```bash
npx tsx ad/meus-perfumes-15s/tools/prepare.mts      # material real (app no ar em :3100; só GET)
cd ad/meus-perfumes-15s
node tools/render.mjs --fps=120 --workers=7          # 1800 quadros no Edge headless (frames/, ~11 min)
node tools/motionblur.mjs plan                       # mede o movimento de cada quadro → frames-mb/jobs.json
node tools/render.mjs --jobs=frames-mb/jobs.json --workers=7   # subquadros extras onde o movimento é rápido
node tools/motionblur.mjs blend                      # obturador de 270°: média de 3–48 instantes → frames30/
node audio/synth.mjs                                 # trilha e sound design sintetizados
node tools/master.mjs                                # -14 LUFS, pico real ≤ -1 dBTP
node tools/encode.mjs                                # MP4 com e sem áudio + capa
```

- `src/ad.html` + `src/ad.js`: compositor — `window.renderAt(t)` desenha qualquer instante (galáxia com o GLSL real do
  app, frascos reais em DOM com o palco do app, partículas em canvas, UI com a fonte e os tokens do app).
- `src/timeline.js`: a linha do tempo única, lida pelo vídeo E pelo áudio (sincronia por construção).
- `src/data.js`, `src/galaxy-shaders.js`, `src/img/`, `src/fonts/`: gerados por `tools/prepare.mts`.
- `tools/render.mjs --times=1.5,6` renderiza só alguns instantes (stills em `out/stills/`).
- Ferramentas: `playwright-core` e `sharp` do próprio projeto; `ffmpeg` isolado em `tools/node_modules`
  (`@ffmpeg-installer/ffmpeg`) — nada instalado no sistema.

- `tools/motionblur.mjs`: desfoque de movimento adaptativo. Com 3 amostras por quadro, um movimento rápido vira 3
  cópias nítidas; onde o deslocamento medido entre subquadros passa de 4 px por amostra, o quadro ganha 6, 12, 24 ou
  48 amostras (as partículas, que já desenham o próprio rastro, ficam com 3).

`frames/`, `frames-mb/` e `frames30/` (PNG, vários GB) são intermediários regeneráveis e podem ser apagados depois
da codificação.

## Adaptação para 1:1 e 16:9

Composição pensada para 9:16 com o conteúdo-chave no quadrado central (y 420–1500) e as áreas de interface do
Reels/TikTok livres. Para 1:1 e 16:9, o compositor recebe outra geometria (constantes de layout no topo de
`src/ad.js`: folha, palco, HUD, cartela) — o HUD passa ao layout de desktop do app, que já existe no produto.
