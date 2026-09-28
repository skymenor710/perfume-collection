# Migração `fase2-20260927` — data/library.json → Postgres (Neon)

## Estado registrado ANTES (27/09/2026, 22:02)

| Arquivo | O quê |
|---|---|
| `baseline.pre-fase2.json` | cópia do `docs/state/baseline.json`: 15 perfumes campo a campo, 32 imagens com SHA-256, Reflection 50 ml |
| `api-baseline.fase1.json` | cópia do `docs/state/api-baseline.json` (API na FASE 1) |
| `api-perfumes.pre-fase2.json` | `GET /api/perfumes` do app rodando, capturado antes da migração (igual ao da FASE 1) |
| `library.json.sha256` | hash do `data/library.json` na hora da captura (`0c63c753…`) |

Backup completo da pasta: `Desktop/perfume-collection-backup-20260927-220242-pre-fase2`. Os baselines anteriores
(`docs/state/*.json`) não foram sobrescritos.

## Configuração (só no `.env.local`, nunca no Git, no chat ou em documentação)

| Variável | O quê |
|---|---|
| `DATABASE_URL` | banco PRINCIPAL, com pooler (host `-pooler`) — o que o app usa |
| `DATABASE_URL_UNPOOLED` | o mesmo banco, conexão direta — migrations no principal |
| `TEST_DATABASE_URL` | branch SEPARADO do Neon, com pooler — exclusivo para testes (é apagado e recriado) |
| `NEON_TEST_DATABASE_NAME` | nome exato do database do branch de testes (ex.: `testes`); qualquer outro nome é recusado |

`npm run db:targets` confere tudo sem mostrar URL: SIM/NÃO, host mascarado, pooler, nome do banco, separação.

## Roteiro FASE 2.5 (validação final; o JSON continua a fonte oficial)

**1. Branch de testes** — tudo que é destrutivo ou concorrente roda SÓ aqui. Cada comando repete a validação do
`db:targets` antes de qualquer DROP SCHEMA / reset / limpeza; se falhar, aborta sem executar nada.

```
npm run db:targets
npm run db:migrate -- --target=test
npm run test:neon                                     # concorrência A–F, pooler, importações, API; limpa no fim
npm run smoke -- --backend=postgres --database=test   # E2E no branch de testes; limpa no fim
```

**2. Banco principal** — só operações não destrutivas, e nenhum write antes do backup.

```
npm run db:status
npm run db:backup                    # data/backups/backup-before-neon-AAAAMMDD-HHMMSS/ (fora do Git)
npm run db:migrate                   # exige backup-before-neon deste banco, < 12 h, do library.json atual
npm run db:import -- --dry-run
npm run db:import                    # idem: exige o backup
npm run db:import                    # de novo: "Nenhuma alteração necessária"
npm run db:verify                    # JSON × Postgres, baseline, Reflection (valores fixos + variant ID), API
npm run state:verify
npm run db:export
```

`db:backup` só LÊ. Guarda: `library.json` (cópia byte a byte), `images.json` (cada referência com SHA-256),
`principal-db.json` (o banco no formato do library.json, se já tiver schema) e `manifest.json` (data, commit do Git,
host mascarado + impressão digital do banco, SHA-256 de tudo).

Relatórios de cada comando: `data/migrations/fase2-20260927/` (fora do Git, nomes únicos).

## Regra de parada

Nenhum comando corrige divergência sozinho. Diferença = falha, com **esperado × encontrado**, e para. A importação
só sobrescreve registros diferentes com `--allow-update` explícito — que NÃO faz parte deste roteiro.

## Comportamentos conhecidos (documentados, sem mudança nesta fase)

- **D — duas alterações simultâneas da mesma entrada:** a API grava o documento inteiro (PUT); as duas gravações
  passam, uma depois da outra, e vale a ÚLTIMA, inteira (nunca mistura campos das duas). Evolução futura: controle
  otimista (versão/ETag e 409) — não nesta fase.
- **F3 — tirar uma versão que outra pessoa escolheu:** a chave estrangeira recusa (`23503`) e a gravação inteira
  sofre ROLLBACK (nenhum campo muda). Tratamento na interface fica para quando houver várias pessoas (FASE 6).

## Ensaio completo (PGlite local, 27/09/2026)

Com o `data/library.json` real, num Postgres local (PGlite): migrate → import dry-run → import → import de novo
(nenhuma alteração) → verify: **0 diferenças**; API `/api/perfumes` idêntica byte a byte à capturada antes;
15 perfumes, 32 imagens (SHA-256), Reflection 50 ml.
