# ADR 0007 — Segurança de saída: portas, IPv6, teto global, tipo real das imagens, modelo fixado

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

O servidor abre links colados pela pessoa. A proteção SSRF já validava IP na conexão e em cada redirecionamento;
a revisão de produção pediu mais camadas.

## Decisão

- Só portas 80/443 (link e redirecionamentos, `nextHop`).
- IPv6 expandido antes de comparar; bloqueados loopback, não especificado, IPv4 mapeado (mesmo público) e compatível,
  NAT64, descarte, **Teredo `2001::/32`**, documentação, ORCHID, **6to4 `2002::/16`**, ULA, link-local, site-local, multicast.
  IPv4 ganhou TEST-NETs e o relay 6to4.
- `EgressLimiter` global (padrão 6 simultâneas, 120/min) em todo pedido externo, inclusive Brave e modelo.
- Imagens: SVG recusado sempre; tipo conferido pelos bytes (PNG, JPEG, WebP, GIF, AVIF) no download e no envio.
- Modelo BiRefNet-lite: URL no commit `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`, SHA-256
  `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` (confere com o `X-Linked-ETag` do Hugging Face e com
  o arquivo local), download só por https para `.part`, verificado antes de entrar; não bate → IA desligada.
- Todas as proteções anteriores mantidas.

## Consequências

- 116 testes em `tests/security.test.ts`; hash de 224 MB calculado uma vez por processo (~1 s) antes de carregar a IA.

## Alternativas consideradas

Proxy de saída dedicado (FASE 5+, se a escala pedir).
