# ADR 0011 — Migração do library.json para Postgres: reversível, verificável, atômica

- **Status:** aceito
- **Data:** 2026-09-28
- **Complementa:** [0003](0003-postgres-neon-drizzle.md)

## Contexto

A FASE 2 troca a fonte oficial da coleção (15 perfumes, 32 imagens, Mykonos Reflection 50 ml) do `data/library.json`
para o Postgres do Neon, sem perder nada, sem mudar a interface e com caminho de volta.

## Decisão

**Schema (migration versionada `drizzle/0000_inicial.sql`; `drizzle-kit push` não é usado).**
- `users ─< entries >─ products ─< product_variants`, `products ─< product_images`; tudo que é de uma pessoa tem `user_id`.
- Chaves estrangeiras **compostas** `(product_id, variant_id)` em `entries` e `product_images`: a versão escolhida e a
  foto de uma versão são sempre do mesmo produto.
- Únicos: entrada por (pessoa, produto, lista), versão por (produto, id), imagem por (produto, referência),
  username sem diferenciar maiúsculas. CHECKs: preço ≥ 0, moeda ISO de 3 letras, volume > 0, formato do username.
- Dinheiro em `numeric(12,2)` (há preços em IDR de 6 dígitos). Volume em `volume_ml numeric` **e** `volume_text`
  (o texto exato, para "50/100 ml" enquanto a versão não foi escolhida). Documentos do app em `json` (preserva o texto,
  a API sai byte a byte igual). IDs atuais preservados.
- Revisão de sincronização em `users.library_revision`, incrementada na mesma transação de cada gravação.

**Importação (`npm run db:import`).** Valida tudo antes (estrutura sem correção silenciosa, referências, unicidade,
valores, arquivos de imagem com SHA-256) → transação única com trava exclusiva → insere o que falta → relê e compara
campo a campo com o JSON **dentro da transação** → checagens do baseline (inclusive Reflection 50 ml) → COMMIT. Qualquer
falha: ROLLBACK. Idempotente; registro diferente no banco = PARA e lista as diferenças (só atualiza com
`--allow-update`); registro só no banco nunca é apagado.

**Duas implementações, um contrato.** `LibraryRepository` ficou assíncrono. `JsonLibraryRepository` (store.ts) e
`PostgresLibraryRepository` usam as mesmas regras (`repositories/rules.ts` + core). `STORAGE_BACKEND=json|postgres`
escolhe em um lugar só (`repositories/index.ts`); com postgres, a partida exige migrations em dia e **nunca** cai em
silêncio para o JSON.

**Concorrência.** Cada gravação trava a linha do dono (`FOR UPDATE`) e roda numa transação; constraints do banco são a
última linha de defesa; importações simultâneas são serializadas por trava consultiva.

**Reversível.** `library.json` nunca é apagado nem reescrito pelo backend postgres; `npm run db:export` gera o mesmo
formato a qualquer momento, e o servidor grava uma cópia assim na partida e a cada 24 h (`data/backups/postgres/`, nenhuma
apagada). O schema tem um SQL de desfazer manual (`drizzle/rollback/0000_inicial.down.sql`).

**Testes contra Postgres de verdade.** PGlite (o Postgres compilado para WebAssembly) por padrão — roda no CI sem conta;
`TEST_DATABASE_URL` roda a mesma suíte num servidor (ex.: um branch de teste do Neon).

## Consequências

- `import_jobs` existe no schema, mas o runner continua em memória (pg-boss é a FASE 4).
- Avisos de revisão (SSE) valem por processo; várias instâncias pedem LISTEN/NOTIFY (FASE 5).
- Produto continua sendo editado pela visão do dono (como no JSON); sobrescrita por pessoa entra com contas (FASE 6).
- `PERFUMES_OWNER_ID` é necessário só quando o banco tiver mais de um usuário.

## Comportamentos conhecidos (decisão consciente nesta fase)

- **Duas alterações simultâneas da mesma entrada (teste D):** última gravação vence, com o documento INTEIRO (a API é
  PUT de documento). Sem ETag/409 nesta fase; é o ponto de evolução natural quando houver várias pessoas/aparelhos.
- **Remover uma versão que outra pessoa escolheu (teste F3):** a FK composta recusa (`23503`) e a transação inteira é
  desfeita. Sem tratamento de conflito na interface por enquanto.
- **Proteções da validação no Neon (FASE 2.5):** o branch de testes precisa ser outro endpoint, passar pelo pooler e,
  com `NEON_TEST_DATABASE_NAME`, ter exatamente esse nome; o banco principal só recebe write depois de um
  `db:backup` (backup-before-neon) recente do mesmo banco e do library.json atual.

## FASE 2.5.1 (hardening pós-switch)

- TLS fixado em memória (`sslmode=verify-full`, `channel_binding=require` respeitado) sem alterar credenciais.
- Marcador de fonte oficial (`data/storage-backend.json`): com o Postgres oficial, a partida com `json` é recusada;
  a volta é só pelo `npm run db:rollback-json -- --confirm` (exporta, confere, arquiva o library.json e o substitui).
- Operação, backup externo recomendado e nota sobre o nome do database de testes: [OPERATIONS.md](../OPERATIONS.md).

## Alternativas consideradas

`drizzle-kit push` (não reproduzível); migrar sem manter o JSON (sem volta); importação sem transação ou sem
verificação interna (metade dos dados em caso de erro); mocks em vez de banco real nos testes (não pegam constraint,
tipo numérico nem transação).
