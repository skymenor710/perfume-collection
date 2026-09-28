# FASE 3 (Cloudflare R2) — inventário técnico

> Gerado em 2026-09-28 a partir do pacote de recuperação `recovery-20260928-192903` (conferido: SHA-256 de cada
> arquivo = original = baseline = banco). **Nada foi migrado.** Este documento só descreve o ponto de partida.

## 1. Números

| | |
|---|---|
| Perfumes (entradas) | 15 |
| Imagens de produto (linhas em `product_images`) | 15 |
| Arquivos de imagem referenciados | **32** (grande + miniatura + mestre PNG quando existe) |
| — da planilha (`bottles/…`, em `apps/web/public/bottles/`) | 26 arquivos · 839.4 KB |
| — importados (`media/…`, em `data/media/`) | 6 arquivos · 1013.3 KB |
| Tamanho total | 1852.7 KB |
| Formatos | webp, png (conferidos pelos bytes) |
| Imagens ligadas a uma versão | 3 (Mykonos Reflection — versão 58518844047705, 50 ml) |

O banco guarda em `product_images` a REFERÊNCIA relativa (`ref`, `thumb_ref`, `master_ref`) e o `sha256` da imagem
principal; os arquivos NÃO estão no banco.

## 2. Inventário (32 arquivos)

| Perfume | Produto | Versão | Papel | Referência no banco | Arquivo hoje | Formato | Tamanho | SHA-256 |
|---|---|---|---|---|---|---|---|---|
| Afnan 9 PM Night Out | `afnan-9-pm-night-out` | — | grande (palco) | `bottles/afnan-9-pm-night-out.6089d9a2-lg.webp` | `apps/web/public/bottles/afnan-9-pm-night-out.6089d9a2-lg.webp` | webp | 93.8 KB | `66f8378d3b3b5b179b430b3987171f3229a3bce8ac45579fe207a9c77fdcedd1` |
| Afnan 9 PM Night Out | `afnan-9-pm-night-out` | — | miniatura | `bottles/afnan-9-pm-night-out.6089d9a2-sm.webp` | `apps/web/public/bottles/afnan-9-pm-night-out.6089d9a2-sm.webp` | webp | 14.6 KB | `9e4fc060a0872fdb5b3a79d36ca971b27d598436853c3b9dadeff6e7dba2cc4e` |
| Afnan Supremacy Collector's Edition | `afnan-supremacy-collector-s-edition` | — | grande (palco) | `bottles/afnan-supremacy-collector-s-edition.e8b9475f-lg.webp` | `apps/web/public/bottles/afnan-supremacy-collector-s-edition.e8b9475f-lg.webp` | webp | 93.5 KB | `f48ccd2fa8bb3ae60e04747f6bc8a6df755e357270ba3fe414a834ad870d0d20` |
| Afnan Supremacy Collector's Edition | `afnan-supremacy-collector-s-edition` | — | miniatura | `bottles/afnan-supremacy-collector-s-edition.e8b9475f-sm.webp` | `apps/web/public/bottles/afnan-supremacy-collector-s-edition.e8b9475f-sm.webp` | webp | 17.1 KB | `d0b042f731396c43ccf4b426b59c5de7eb09bb5ef78acb48ebf4ff2e6adb31c5` |
| Afnan Supremacy In Heaven | `afnan-supremacy-in-heaven` | — | grande (palco) | `bottles/afnan-supremacy-in-heaven.80fb764f-lg.webp` | `apps/web/public/bottles/afnan-supremacy-in-heaven.80fb764f-lg.webp` | webp | 43.1 KB | `7e2caa4da893168bb55b2910fa8d38b1cf7a89339145c757b7d52b9b311fa3cd` |
| Afnan Supremacy In Heaven | `afnan-supremacy-in-heaven` | — | miniatura | `bottles/afnan-supremacy-in-heaven.80fb764f-sm.webp` | `apps/web/public/bottles/afnan-supremacy-in-heaven.80fb764f-sm.webp` | webp | 10.6 KB | `75846bbce90bfcccd6d54a741b7ff9df692b7c98480751fe9f3b3ab523220cb3` |
| Afnan Supremacy Not Only Intense | `afnan-supremacy-not-only-intense` | — | grande (palco) | `bottles/afnan-supremacy-not-only-intense.285bd80c-lg.webp` | `apps/web/public/bottles/afnan-supremacy-not-only-intense.285bd80c-lg.webp` | webp | 40.5 KB | `fb05c4430be39e11f758ad31b84d4106f9e42587c5c5fe2cb1f76c61b8d85e07` |
| Afnan Supremacy Not Only Intense | `afnan-supremacy-not-only-intense` | — | miniatura | `bottles/afnan-supremacy-not-only-intense.285bd80c-sm.webp` | `apps/web/public/bottles/afnan-supremacy-not-only-intense.285bd80c-sm.webp` | webp | 10.2 KB | `6c425c282cef44d7bbd6cdd8d5b0a07c8c3fc2f9d654cbd256cccefbd17ec227` |
| Armaf Club de Nuit Elite | `armaf-club-de-nuit-elite` | — | grande (palco) | `bottles/armaf-club-de-nuit-elite.4f13c53e-lg.webp` | `apps/web/public/bottles/armaf-club-de-nuit-elite.4f13c53e-lg.webp` | webp | 48.2 KB | `550b15dcbaf7bd5c20b29862f47e61e260dc6f2536f0c6d8a76d953c2554059d` |
| Armaf Club de Nuit Elite | `armaf-club-de-nuit-elite` | — | miniatura | `bottles/armaf-club-de-nuit-elite.4f13c53e-sm.webp` | `apps/web/public/bottles/armaf-club-de-nuit-elite.4f13c53e-sm.webp` | webp | 11.4 KB | `e5f23ecaf64d2197e6dda13418454c88e515330ef26f6beaae53ad26f299a50d` |
| Armaf Club de Nuit Precieux | `armaf-club-de-nuit-precieux` | — | grande (palco) | `bottles/armaf-club-de-nuit-precieux.628aa881-lg.webp` | `apps/web/public/bottles/armaf-club-de-nuit-precieux.628aa881-lg.webp` | webp | 26.1 KB | `02a2bec8a5cb84bd88550c04f01dd12bdec140a5f9a8d34f3bd6f6ee0b840ba3` |
| Armaf Club de Nuit Precieux | `armaf-club-de-nuit-precieux` | — | miniatura | `bottles/armaf-club-de-nuit-precieux.628aa881-sm.webp` | `apps/web/public/bottles/armaf-club-de-nuit-precieux.628aa881-sm.webp` | webp | 7.5 KB | `40019c50dfc251071f64d4bc6ecbaec2e0059aa1ff7134f43c86dca874ac8d34` |
| French Avenue Azzure Aoud | `french-avenue-azzure-aoud-7m3nwa` | — | grande (palco) | `media/mujwsz73-674444159b-lg.webp` | `data/media/mujwsz73-674444159b-lg.webp` | webp | 31.4 KB | `31b27c468698efcc7af9c7ef38ae16b20aced7d8f071209d93bbc64570ca4290` |
| French Avenue Azzure Aoud | `french-avenue-azzure-aoud-7m3nwa` | — | miniatura | `media/mujwsz73-674444159b-sm.webp` | `data/media/mujwsz73-674444159b-sm.webp` | webp | 8.4 KB | `3938027bac64d55357c399dc650d9dc04f18c75ef30ddad8a6183e9e8de1613e` |
| French Avenue Azzure Aoud | `french-avenue-azzure-aoud-7m3nwa` | — | mestre PNG 2048² | `media/mujwsz73-674444159b.png` | `data/media/mujwsz73-674444159b.png` | png | 517.2 KB | `8aa54003c2fdb62d1d20152c648227156af32d543dec4aa2071a0ecb29e1927f` |
| French Avenue Spectre Ghost | `french-avenue-spectre-ghost` | — | grande (palco) | `bottles/french-avenue-spectre-ghost.321b97e3-lg.webp` | `apps/web/public/bottles/french-avenue-spectre-ghost.321b97e3-lg.webp` | webp | 53.5 KB | `d116f8fb86e303a7cf86de96422849aee755f8223124a8dbc70be57bf7d37527` |
| French Avenue Spectre Ghost | `french-avenue-spectre-ghost` | — | miniatura | `bottles/french-avenue-spectre-ghost.321b97e3-sm.webp` | `apps/web/public/bottles/french-avenue-spectre-ghost.321b97e3-sm.webp` | webp | 12.2 KB | `b9ad871ddb4fd45cab43a329c9eab348f343aec80d7c3e9a05955ae02d6f8c4e` |
| Khadlaj Island Dreams | `khadlaj-island-dreams` | — | grande (palco) | `bottles/khadlaj-island-dreams.4059eec0-lg.webp` | `apps/web/public/bottles/khadlaj-island-dreams.4059eec0-lg.webp` | webp | 73.5 KB | `1524bbbf9b2d7062e3896d3bc69569fe54d02ce51a556c295c752611e33843ec` |
| Khadlaj Island Dreams | `khadlaj-island-dreams` | — | miniatura | `bottles/khadlaj-island-dreams.4059eec0-sm.webp` | `apps/web/public/bottles/khadlaj-island-dreams.4059eec0-sm.webp` | webp | 14.4 KB | `bf5cd28355551eb0561901d85231467cb97afe614acbee4b171e1a05b7c3dab9` |
| Khadlaj Shiyaaka Snow | `khadlaj-shiyaaka-snow` | — | grande (palco) | `bottles/khadlaj-shiyaaka-snow.e1b92151-lg.webp` | `apps/web/public/bottles/khadlaj-shiyaaka-snow.e1b92151-lg.webp` | webp | 45.0 KB | `2a6ef1caa41da2b711178c5b29f1da213340755ee526de391d03968296d4a451` |
| Khadlaj Shiyaaka Snow | `khadlaj-shiyaaka-snow` | — | miniatura | `bottles/khadlaj-shiyaaka-snow.e1b92151-sm.webp` | `apps/web/public/bottles/khadlaj-shiyaaka-snow.e1b92151-sm.webp` | webp | 13.1 KB | `4747b4fe000f0075c5b34d3290a01e26979ea9011455d4f14a375c77ab351125` |
| Maison Asrar Vanguard | `maison-asrar-vanguard` | — | grande (palco) | `bottles/maison-asrar-vanguard.0d6d8c64-lg.webp` | `apps/web/public/bottles/maison-asrar-vanguard.0d6d8c64-lg.webp` | webp | 47.3 KB | `2cf5cbfef82d462abf5626effb84e97ad66c978012f04659c4331ef1bb8205a5` |
| Maison Asrar Vanguard | `maison-asrar-vanguard` | — | miniatura | `bottles/maison-asrar-vanguard.0d6d8c64-sm.webp` | `apps/web/public/bottles/maison-asrar-vanguard.0d6d8c64-sm.webp` | webp | 12.2 KB | `e323d7abdf851d0094f20bb7d3a289ac6e5c7a6bf4db71a752838efb68a2d31c` |
| Mykonos Reflection | `mykonos-reflection-r5rx34` | 58518844047705 (50ml (50 ml)) | grande (palco) | `media/mujy19m7-5e3d3e1f9f-lg.webp` | `data/media/mujy19m7-5e3d3e1f9f-lg.webp` | webp | 26.2 KB | `3a5c6ff8a53977989b7bf9d9d5f3162c81902113f94e12cb4f6d73dfbe4d4820` |
| Mykonos Reflection | `mykonos-reflection-r5rx34` | 58518844047705 (50ml (50 ml)) | miniatura | `media/mujy19m7-5e3d3e1f9f-sm.webp` | `data/media/mujy19m7-5e3d3e1f9f-sm.webp` | webp | 7.5 KB | `a92b4accb70e99ac4e1497531f35e5a7ce496458ca708405083594fd2c225217` |
| Mykonos Reflection | `mykonos-reflection-r5rx34` | 58518844047705 (50ml (50 ml)) | mestre PNG 2048² | `media/mujy19m7-5e3d3e1f9f.png` | `data/media/mujy19m7-5e3d3e1f9f.png` | png | 422.6 KB | `b3716f7a30a104f41975d0303341075d31e6d565b3c4725f5b8e68c42f63e1ab` |
| Mykonos × RRQ Empire | `mykonos-x-rrq-empire` | — | grande (palco) | `bottles/mykonos-x-rrq-empire.3b8aa5ac-lg.webp` | `apps/web/public/bottles/mykonos-x-rrq-empire.3b8aa5ac-lg.webp` | webp | 23.1 KB | `7f6110b04998338cf18389fe2d43d0e8874070d168d01be0f855dd25e37ccb83` |
| Mykonos × RRQ Empire | `mykonos-x-rrq-empire` | — | miniatura | `bottles/mykonos-x-rrq-empire.3b8aa5ac-sm.webp` | `apps/web/public/bottles/mykonos-x-rrq-empire.3b8aa5ac-sm.webp` | webp | 7.0 KB | `cef5fb2c9c3eeecd687a7586176a7158a8a24559652498da02974d35a0c830cd` |
| Nusuk Ateeq | `nusuk-ateeq` | — | grande (palco) | `bottles/nusuk-ateeq.070daa67-lg.webp` | `apps/web/public/bottles/nusuk-ateeq.070daa67-lg.webp` | webp | 70.5 KB | `fb0d36d54fe2bb4b8530f57f9c0746e4e572e08eb700851428188e6f58466937` |
| Nusuk Ateeq | `nusuk-ateeq` | — | miniatura | `bottles/nusuk-ateeq.070daa67-sm.webp` | `apps/web/public/bottles/nusuk-ateeq.070daa67-sm.webp` | webp | 15.5 KB | `200c9b9388bd42dc27d73885a92f5d8eeef31ce65fffef37e7e8b40d6bf53ca8` |
| Rayhaan Cedrus Blanc | `rayhaan-cedrus-blanc` | — | grande (palco) | `bottles/rayhaan-cedrus-blanc.31af0f39-lg.webp` | `apps/web/public/bottles/rayhaan-cedrus-blanc.31af0f39-lg.webp` | webp | 27.8 KB | `54b122ae2210c5532b17e0434740687b48929cd802c2ddcda5241920140e0905` |
| Rayhaan Cedrus Blanc | `rayhaan-cedrus-blanc` | — | miniatura | `bottles/rayhaan-cedrus-blanc.31af0f39-sm.webp` | `apps/web/public/bottles/rayhaan-cedrus-blanc.31af0f39-sm.webp` | webp | 7.7 KB | `1a313c18f6798f29493efa2e074c93e702ce438fe5b5f077607f30689941dc23` |

## 3. Onde o código usa armazenamento de imagens hoje

**Já passam pelo `StorageProvider`** (trocar a implementação basta):

| Ponto | Arquivo | O que faz |
|---|---|---|
| Gravação de foto nova | `apps/server/src/media/store.ts` (`saveBottleMedia`) | `put` de PNG mestre + WebP grande/pequeno; `publicUrl` vira a referência gravada |
| Servir `/media/*` | `apps/server/src/http/app.ts` (rota `/media/`) | `media.get` + cache imutável; pública só se a foto estiver numa lista pública (`isPublicMedia`) |
| Limpeza de órfãos | `apps/server/src/media/gc.ts` | `list` → cópia para a lixeira (`trashFor`) → `delete` |
| Implementação atual | `apps/server/src/storage/local.ts` | `LocalStorageProvider` em `data/media`, chaves validadas |

**NÃO passam pelo `StorageProvider` e precisarão mudar para o R2:**

| Ponto | Arquivo | Por quê muda |
|---|---|---|
| Fotos da planilha | `apps/web/public/bottles/` (servidas como estáticos) e `scripts/research-seed.ts` (grava lá) | ficam fora do provider; entram no R2 como qualquer outra foto |
| Validação de referência | `packages/core/src/perfume.ts` (`safeImageRef`) | só aceita `bottles/<arquivo>` / `media/<arquivo>` (sem subpastas) ou http(s): chaves por conteúdo (`p/<sha>/…`) exigem ajuste |
| Montagem do endereço no navegador | `apps/web/src/lib/refs.ts` (`assetRef`) | prefixa a base do app; com R2, referência → URL do `img.<domínio>` |
| CSP | `apps/server/src/http/app.ts` (`img-src 'self' data: blob:`) | precisa incluir a origem do R2 |
| Service worker | `apps/web/public/sw.js` | cacheia só `/bottles/*` e `/media/*` da própria origem |
| Resolução de arquivo p/ verificação | `apps/server/src/db/checks.ts` (`resolveImageFile`), `scripts/verify-state.mjs`, `db:backup`, pacote de recuperação | leem o disco local; precisam de um resolvedor R2 (ou download) para conferir SHA-256 |
| Importação/validação | `apps/server/src/db/importer.ts` (imagens precisam existir) | idem |
| Páginas públicas / Open Graph | `apps/server/src/http/seo.ts` (`image: ${origin}/${cover}`) | a imagem de prévia passa a ser a URL do R2 |
| Atualização da semente na partida | `apps/server/src/repositories/rules.ts` (`seedUpgrades`) | reconhece a foto da semente por `startsWith('bottles/')` e, quando a semente tem `assetVersion` maior, **regrava** `imageUrl`/`thumbUrl` com a referência `bottles/…` dela. Depois da virada para chaves R2 isso poderia devolver referências locais ao banco a cada partida — precisa conhecer o mapa referência→chave (ou a semente passar a usar as chaves) |
| Proveniência das fotos da planilha | `scripts/embed-provenance.ts` | grava um `.json` ao lado de cada `bottles/*.webp`; no R2 vira metadado do objeto ou fica só local |

**Fora do escopo do R2:** o modo "link do claude.ai" (`apps/web/src/data/repository.ts`) guarda fotos como assets do
próprio artifact (`/_blob/<id>`), sem servidor. `apps/web/src/data/` só passou a ser versionada na FASE 2.5.4.

**Auditoria contra o código (FASE 2.5.4, commit `f785520`):** todos os pontos das duas tabelas existem onde estão
descritos; o contrato `StorageProvider` já tem `put/get/delete/exists/publicUrl/list`; nada da FASE 3 existe ainda
(`R2StorageProvider` só num comentário de planejamento em `storage/types.ts`; nenhum `MEDIA_BACKEND`, `storage_key` ou
endpoint do R2; as chaves `R2_*` só reservadas como segredo em `config.ts`).

## 4. Estratégia recomendada — migração sem downtime

1. **R2StorageProvider** (mesmo contrato: `put/get/delete/exists/publicUrl/list`) + configuração `MEDIA_BACKEND=local|r2` (o local
   continua padrão). Chaves **por conteúdo**: `p/<sha256>/<variante>.webp|png` — a mesma foto nunca é gravada duas vezes e
   uma URL nunca muda de conteúdo (cache imutável seguro).
2. **Cópia, não mudança:** copiar as 32 fotos para o R2 com a chave nova, conferindo o SHA-256 depois do upload (seção 6).
   Nada no banco muda nesta etapa; o app segue servindo do disco.
3. **Mapa de referências** (tabela nova ou coluna `storage_key` em `product_images`, por migration): referência antiga → chave R2,
   preenchido só para arquivos conferidos. Leitura com **fallback**: tenta R2; se a chave não existe, serve do local.
4. **Virada por referência, em transação:** atualizar as referências no banco para as chaves R2 (com `db:backup` antes), conferir com
   `db:verify` + checagem de SHA-256 no R2; fotos novas passam a ir direto para o R2.
5. **Janela de convivência:** manter `data/media` e `bottles/` intactos (somente leitura) até o fim da validação; nada é apagado.

## 5. Estratégia de rollback

- Até o passo 4: basta `MEDIA_BACKEND=local` — o banco ainda aponta para as referências locais.
- Depois do passo 4: o mapa referência↔chave permite reescrever as referências de volta em uma transação (com backup antes);
  os arquivos locais continuam no disco, byte a byte iguais (mesmo SHA-256).
- O pacote de recuperação (`data/backups/recovery/`, com cópia no OneDrive em `Backups/MeusPerfumes/`) guarda as 32
  imagens e o inventário — independente do R2.

## 6. Como provar que a imagem no R2 é byte a byte igual

1. **Antes do upload:** SHA-256 local (este inventário).
2. **No upload:** enviar `x-amz-checksum-sha256` (base64 do SHA-256); o R2 recusa se o conteúdo chegar diferente.
3. **Depois:** baixar o objeto pelo endpoint S3 (não pela CDN) e recalcular o SHA-256; comparar com o inventário e com
   `product_images.sha256`. Conferir também tamanho (`Content-Length`) e `Content-Type` (pelos bytes, não pela extensão).
4. **Pela URL pública:** repetir o SHA-256 via `img.<domínio>` (pega problema de CDN/transformação).
5. A chave por conteúdo já carrega o hash no nome: `p/<sha256>/…` — objeto cujo hash não bate com a própria chave é recusado.
