# ADR 0003 — Postgres (Neon) + Drizzle; nesta etapa só o schema preliminar

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

`library.json` não tem transação nem suporta várias instâncias. A decisão de produção (PRODUCTION.md §2) é Neon
+ Drizzle. Migrar agora, sem o resto da infraestrutura, arriscaria os dados sem ganho.

## Decisão

- `apps/server/src/db/schema.ts`: users, products, product_variants, product_images, entries, import_jobs.
- **Sem conexão, sem driver, sem migration.** `library.json` segue a fonte de verdade.
- Ids em texto (os atuais são preservados); imagens guardam **chave** de armazenamento, não URL.
- Porta `LibraryRepository` (`repositories/library.ts`); `store.ts` a implementa. A implementação Postgres entra na
  FASE 2 pelo mesmo contrato.
- Teste confere que todo campo do domínio atual tem coluna; outro teste garante que nenhum driver de banco é importado.

## Consequências

- A migração da FASE 2 terá comparação de ida e volta (`state:verify`, `api-baseline.json`).
- Testes usam a implementação real numa pasta temporária — nada de banco falso.

## Alternativas consideradas

SQLite/Turso, Supabase, Firestore, Postgres do Railway (ver PRODUCTION.md §2).
