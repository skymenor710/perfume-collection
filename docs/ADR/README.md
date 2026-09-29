# Registro de decisões de arquitetura (ADR)

Uma decisão por arquivo: contexto, decisão, consequências, alternativas. Decisão mudou? Novo ADR que "substitui" o antigo
(o antigo fica, com status atualizado).

| # | Decisão | Status |
|---|---|---|
| 0001 | [Monorepo com npm workspaces: apps/web, apps/server, packages/core](0001-monorepo-npm-workspaces.md) | aceito |
| 0002 | [Hono entra aos poucos: /api/v1 montado dentro do servidor atual](0002-hono-incremental-api-v1.md) | aceito |
| 0003 | [Postgres (Neon) + Drizzle; nesta etapa só o schema preliminar](0003-postgres-neon-drizzle.md) | aceito |
| 0004 | [StorageProvider para as fotos; R2 depois](0004-storage-provider.md) | aceito |
| 0005 | [Importação como job (criar → acompanhar → resultado)](0005-importacao-como-job.md) | aceito |
| 0006 | [Registro de fontes com disjuntor](0006-registro-de-fontes-e-disjuntor.md) | aceito |
| 0007 | [Segurança de saída: portas, IPv6, teto global, tipo real das imagens, modelo fixado](0007-seguranca-de-saida.md) | aceito |
| 0008 | [Logs estruturados (pino) com redação](0008-logs-estruturados.md) | aceito |
| 0009 | [Configuração só pelo ambiente, validada por zod](0009-configuracao-validada.md) | aceito |
| 0010 | [Autorização por Principal (preparo para contas)](0010-autorizacao-por-principal.md) | aceito |
| 0011 | [Migração do library.json para Postgres: reversível, verificável, atômica](0011-migracao-json-postgres.md) | aceito |
| 0012 | [Fotos no R2: chaves por conteúdo, prova por SHA-256 e mapa de migração](0012-r2-chaves-por-conteudo-e-mapa.md) | aceito |
