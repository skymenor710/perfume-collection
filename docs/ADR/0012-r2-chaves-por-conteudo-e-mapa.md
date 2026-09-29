# ADR 0012 — Fotos no R2: chaves por conteúdo, prova por SHA-256 e mapa de migração em arquivo

- **Status:** aceito (FASE 3.0 — implementado e testado localmente; nada enviado ao R2)
- **Data:** 2026-09-29
- **Complementa:** [0004](0004-storage-provider.md)

## Contexto

As 32 fotos da coleção (26 `bottles/`, 6 `media/`) moram só neste computador. A FASE 3 leva as fotos para o Cloudflare
R2 sem perder nenhuma, sem mudar o app no modo local e com caminho de volta. Nesta fase o Neon e o schema não podem
mudar.

## Decisão

1. **R2 é mais uma implementação do `StorageProvider`** (`storage/r2.ts`), via API S3 assinada com `aws4fetch` (MIT,
   sem dependências, o recomendado pela Cloudflare) — não um SDK, não uma segunda arquitetura. O contrato ganhou
   `sha256` no `put` e a distinção entre "não existe" (null/false) e "indisponível" (`StorageUnavailableError`).
2. **Chave = `p/<sha256>.<formato real>`.** Identidade pelo conteúdo; extensão pelos bytes; mesma foto = um objeto
   (deduplicação), chave imutável (cache de 1 ano seguro), sem caminho perigoso possível. O nome útil fica no mapa.
3. **Migrado = provado.** Só depois de baixar o objeto e o SHA-256 bater ele vira `validated`; HTTP 200 não basta.
4. **Mapa em `data/media-map.json`**, não em tabela: uma migration pendente faria o app recusar a partida e aplicá-la no
   Neon não estava autorizado. Arquivo com schema validado (ilegível = erro), gravação atômica sob trava de arquivo,
   diário da virada para a volta exata, incluído no `db:backup`. A interface `MediaMap` permite mover para uma tabela na
   FASE 3.2, para gravar referências e diário na mesma transação.
5. **A página não conhece o R2**: referência `p/…` → `/p/…` no próprio servidor, que redireciona para o R2 (validado)
   ou serve a cópia local conferida (modo local, ou fallback explícito `MEDIA_FALLBACK=local`, sempre com log). Sem
   fallback, objeto não validado = 404 + log de erro: migração incompleta não fica escondida.
6. **CSP** libera só a origem de `R2_PUBLIC_BASE_URL`, e só com `MEDIA_BACKEND=r2`.
7. **Virada tudo-ou-nada** e **volta pelo diário** (ambíguo bloqueia), como funções puras testadas; aplicar no banco
   fica para a FASE 3.2.

## Consequências

- Modo local idêntico ao de antes (API byte a byte, CSP, service worker, fotos novas com nome aleatório).
- Fotos novas no modo r2 ficam em dobro (cópia local + R2) — a volta nunca depende de baixar do R2. Custo: o tamanho
  das fotos no disco (hoje 1,85 MB).
- O mapa é estado crítico fora do banco: precisa estar no backup (está) e no pacote de recuperação.
- Não há limpeza de órfãos no R2 (objetos por conteúdo são imutáveis e baratos); só no disco local.
- A assinatura SigV4 e o checksum só são provados contra o R2 real na FASE 3.1.
