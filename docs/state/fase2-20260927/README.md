# Migração `fase2-20260927` — data/library.json → Postgres (Neon)

## Estado registrado ANTES (27/09/2026, 22:02)

| Arquivo | O quê |
|---|---|
| `baseline.pre-fase2.json` | cópia do `docs/state/baseline.json`: 15 perfumes campo a campo, 32 imagens com SHA-256, Reflection 50 ml |
| `api-baseline.fase1.json` | cópia do `docs/state/api-baseline.json` (API na FASE 1) |
| `api-perfumes.pre-fase2.json` | `GET /api/perfumes` do app rodando, capturado antes da migração (igual ao da FASE 1) |
| `library.json.sha256` | hash do `data/library.json` na hora da captura (`0c63c753…`) |

Backup completo da pasta: `Desktop/perfume-collection-backup-20260927-220242-pre-fase2` (500 arquivos, library.json com o
mesmo hash). Os baselines anteriores (`docs/state/*.json`) não foram sobrescritos.

## Roteiro

```
npm run db:status                        # o que está aplicado no banco de DATABASE_URL
npm run db:migrate                       # aplica drizzle/0000_inicial.sql (e as próximas, em ordem)
npm run db:import -- --dry-run           # ensaio: valida, importa, verifica, desfaz
npm run db:import                        # importação real (transação única; verificada antes do COMMIT)
npm run db:import                        # de novo: tem de dizer "Nenhuma alteração necessária"
npm run db:verify                        # JSON × Postgres (todos os campos), baseline, API byte a byte
```

Troca da fonte oficial: `STORAGE_BACKEND=postgres` no `.env.local` e reiniciar (`npm run app:stop` → `npm run app`).
Voltar: `STORAGE_BACKEND=json` (o `data/library.json` fica intacto) — se o app já gravou no Postgres, antes
`npm run db:export` e copiar a exportação para `data/library.json`.

Relatórios de cada execução: `data/migrations/fase2-20260927/` (fora do Git, nomes únicos).

## Ensaio completo (PGlite local, 27/09/2026)

Com o `data/library.json` real, num Postgres local (PGlite em `data/pg-ensaio/`, sem conta):
migrate → import dry-run → import → import de novo (nenhuma alteração) → verify: **0 diferenças**; API
`/api/perfumes` idêntica byte a byte à capturada antes; 15 perfumes, 32 imagens (SHA-256), Reflection 50 ml.
