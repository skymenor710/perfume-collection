# ADR 0004 — StorageProvider para as fotos; R2 depois

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

Fotos em `data/media` (disco local) não sobrevivem a um container. O destino é Cloudflare R2.

## Decisão

- Porta `StorageProvider`: `put`, `get`, `delete`, `exists`, `publicUrl`, `list`.
- `LocalStorageProvider` (data/media): chave validada (sem `..`, barra inicial ou caractere estranho) **e** caminho
  conferido dentro da pasta; gravação atômica (temporário + rename).
- `saveBottleMedia`, a rota `/media` e a limpeza de órfãos usam a porta. `publicUrl` devolve `media/<chave>` — o mesmo
  formato já gravado na biblioteca (nenhuma referência mudou).
- **Nenhum upload para o R2 nesta etapa.**

## Consequências

- `R2StorageProvider` (FASE 3) com chaves por conteúdo e `img.` subdomínio troca só a implementação.
- A limpeza continua olhando só o nível de cima da pasta, como antes.

## Alternativas consideradas

S3 (custo de saída), volume do Railway (não é object storage).
