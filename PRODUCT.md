# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React 19 + TypeScript, WebGL2 próprio para a galáxia, three.js carregado sob demanda só para modelos GLB. Servidor Node local (tsx) para importar links. Escolhido por mim a partir do pedido ("choose the best architecture") e da experiência do projeto FitCheck deste usuário; o usuário escolheu o modo "Link + computador" (link do claude.ai + `npm start`).

## Users

O próprio usuário (Guilherme), colecionador de perfumes árabes/de nicho acessíveis, que mantém uma lista de desejos e quer ver e julgar o que já comprou. Usa no celular (toque, uma mão) e no computador.

## Product Purpose

Uma coleção pessoal de perfumes — Wishlist e Minha coleção — navegada como a tela de seleção de personagem de um jogo AAA, num espaço escuro cuja cor responde ao frasco selecionado. Sucesso: abrir e sentir "estou percorrendo a minha coleção num ambiente 3D premium", não uma planilha nem uma loja.

## Positioning

O frasco é o protagonista; a interface nunca compete com ele. A atmosfera (galáxia) é tingida pela cor extraída do próprio frasco, em 2–10% da tela.

## Capabilities and Constraints

- Dados iniciais: planilha "Lista de Perfumes" do usuário (14 perfumes, todos desejos). Importada uma vez; o app não depende dela.
- Adicionar por link: completo no servidor local; no link do claude.ai, palpite pelo endereço + foto enviada pela pessoa.
- Veredito pessoal (só na coleção), com os rótulos em português: Comprar novamente, Muito bom, Bom, Não comprar novamente. Nunca estrelas.
- Modelos 3D reais entram por `model3DUrl`; nenhum modelo inventado apresentado como real.
- Lojas que bloqueiam leitura automática (Cdiscount, às vezes Amazon) caem no cadastro manual; não contornar bloqueios.

## Brand Commitments

Direção visual fixada pelo usuário: preto profundo, carvão, branco, cinza suave, prata sutil; inspiração (não cópia) em velixir.co.uk; minimalismo, espaço vazio, luxo futurista. Microcópia em português do Brasil.

## Evidence on Hand

- `scripts/seed-source.ts`: as 14 linhas da planilha, com as URLs reais dos hiperlinks.
- `public/bottles/`: fotos de produto das próprias páginas dos links (Afnan 9 PM: site oficial da marca, porque a Cdiscount bloqueia leitura), com fundo recortado.
- Não há modelos 3D, notas olfativas nem histórico de preço: não inventar.

## Product Principles

1. O frasco primeiro: hierarquia frasco → identidade → navegação → controles → atmosfera.
2. Cor como sotaque, nunca como tema: a galáxia continua preta.
3. Mesmo universo para desejos e coleção; muda o conteúdo, não a interface.
4. Honestidade de dados: campo ausente fica ausente; foto é foto, 3D é 3D.

## Accessibility & Inclusion

Teclado completo, leitor de tela (lista acessível espelhando o carrossel), foco visível, contraste AA, `prefers-reduced-motion` respeitado.
