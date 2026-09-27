# ADR 0002 — Hono entra aos poucos: /api/v1 montado dentro do servidor atual

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

O roteador manual (~400 linhas) funciona e tem proteções testadas (Host, mesma origem, pareamento). Reescrever
tudo de uma vez arriscaria regressão; autenticação e middlewares, porém, pedem um framework.

## Decisão

- O handler atual continua dono do servidor HTTP e roda `checkHost` e `checkSameOrigin` antes de tudo.
- Pedidos `/api/v1/*` são entregues a um app Hono (`@hono/node-server` `getRequestListener`); o resto segue nas
  rotas atuais, sem mudança de formato.
- v1: `health` (público), `me`, `perfumes`, `wishlist`, `collection`, `imports` (+ `events`, `retry`, cancelamento),
  `sources`. Limite de corpo de 64 KB enquanto chega; erros como `{ error: { code, message } }` com frase para a pessoa.
- Escrita de perfumes continua nas rotas atuais (a interface não mudou).

## Consequências

- Rotas antigas intactas (smoke 56/56); a interface pode migrar rota a rota quando fizer sentido.
- Quando todas as rotas estiverem na v1, o handler manual vira só a casca de Host/estáticos — ou sai.

## Alternativas consideradas

Express/Fastify (mais pesados, menos alinhados a Web Standards); reescrita total (risco).
