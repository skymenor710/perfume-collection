# Operação — Meus Perfumes (Postgres/Neon como fonte oficial)

> Estado em 28/09/2026 (FASE 2.5.1). A coleção mora no Postgres do Neon (`STORAGE_BACKEND=postgres`); o
> `data/library.json` está PARADO desde o switch e serve só como histórico. Nada aqui contém credencial: elas vivem
> apenas no `.env.local` (fora do Git).

## 1. Onde está cada coisa

| O quê | Onde | Observação |
|---|---|---|
| Coleção (fonte oficial) | Neon — branch principal, database `neondb` | app pelo pooler (`DATABASE_URL`); migrations pela conexão direta (`DATABASE_URL_UNPOOLED`) |
| Marcador de fonte oficial | `data/storage-backend.json` | `official: postgres` + SHA-256 do library.json parado; renovado a cada partida |
| library.json parado (histórico) | `data/library.json` (SHA-256 `0c63c753…`) | o app NÃO grava mais nele |
| Imagens | `data/media/` (importadas) e `apps/web/public/bottles/` (planilha) | só neste computador até a FASE 3 (R2) |
| Cópias automáticas do Postgres | `data/backups/postgres/library-<data>.json` | na partida e a cada 24 h; nenhuma apagada |
| Backups antes de marcos | `data/backups/backup-before-neon-…`, `backup-before-storage-backend-postgres-switch-…`, `backup-hardening-2-5-1-…` | `db:backup --label=…` |
| Exportações | `data/exports/library.postgres-….json` | `npm run db:export` |
| Schema | `apps/server/drizzle/0000_inicial.sql` (+ `rollback/0000_inicial.down.sql`, manual) | só por migration versionada |

## 2. Backup externo (recomendação — NÃO automatizado)

**Hoje não existe backup fora deste computador.** Verificado em 28/09/2026: a Área de Trabalho não está no OneDrive,
o repositório Git não tem remoto e as três cópias completas (`Desktop/perfume-collection-backup-*`) estão no mesmo
disco C:. A única cópia fora da máquina é o próprio Neon (histórico de restauração do banco, sem as imagens).

**Pacote mínimo a preservar fora do computador** (um destino que o dono escolher: pendrive/HD externo, ou uma pasta
do OneDrive que ele já usa — nunca junto de credenciais):

| # | Item | Arquivo(s) | Por quê |
|---|---|---|---|
| 1 | Export do Postgres | o `data/exports/library.postgres-*.json` mais recente (ou `principal-db.json` do último `db:backup`) | a coleção de hoje, no formato que o app sabe ler |
| 2 | library.json original | `data/library.json` (SHA-256 `0c63c753…`) | histórico do estado antes do switch |
| 3 | Manifesto/checksum | `manifest.json` + `images.json` do último `data/backups/backup-*` | prova de integridade (SHA-256 de tudo) |
| 4 | Imagens | `data/media/` inteira + `apps/web/public/bottles/` | as fotos NÃO estão no banco |
| 5 | Versão/schema | `apps/server/drizzle/` + `docs/` + commit do Git (`git log -1`) | para reconstruir o banco e saber qual código gerou os dados |

**Nunca** copiar: `.env.local`, `data/devices.json`, qualquer arquivo com connection string. Conferência depois de
copiar: o SHA-256 dos arquivos no destino tem de bater com o `manifest.json`/`images.json`.

Frequência sugerida: depois de cada sessão de importações e antes de qualquer fase nova (R2, deploy).
A FASE 5 prevê `pg_dump` diário para um bucket separado — isso substitui este passo manual.

## 3. SSL/TLS do banco

- As três URLs usam `sslmode=require&channel_binding=require` (padrão do Neon). **As credenciais não foram alteradas.**
- O driver `pg` 8.x trata `require` como `verify-full` (certificado + nome do host conferidos), mas o `pg` 9 vai passar
  à semântica do libpq, em que `require` NÃO confere o certificado. Para não perder a proteção numa atualização,
  `apps/server/src/db/client.ts` (`pgConnectionOptions`) fixa **em memória** `sslmode=verify-full`.
- O `pg` ignora `channel_binding` na URL; o mesmo ponto liga `enableChannelBinding` quando a URL pede
  `channel_binding=require` (SCRAM-SHA-256-PLUS quando o servidor oferece).
- Validado em 28/09/2026, só leitura (transação READ ONLY), no principal pelo pooler e pela conexão direta:
  TLS 1.3, certificado verificado (`*.c-6.eu-central-1.aws.neon.tech`), `sslmode` efetivo `verify-full`. O driver não
  expõe qual mecanismo SCRAM foi negociado: channel binding está **pedido e aceito**, não comprovado.
- O aviso "SECURITY WARNING: The SSL modes…" do driver deixou de aparecer no log.

## 4. Rollback (voltar do Postgres para o JSON)

**Regra: nunca ligar `STORAGE_BACKEND=json` com o library.json parado.** Ele tem os dados do dia do switch; tudo o
que o app gravou depois está só no Postgres.

Proteção implementada (FASE 2.5.1):

- O servidor, ao subir com Postgres, grava/renova `data/storage-backend.json` (`official: postgres`).
- Com esse marcador, a partida com `STORAGE_BACKEND=json` é **recusada** (sem ler nem regravar o library.json), com a
  explicação do caminho certo.
- A volta é **explícita** e em dois passos:
  1. `npm run db:rollback-json` (ensaio) e depois `npm run db:rollback-json -- --confirm`:
     exporta o Postgres de agora e confere com o banco → **arquiva** o library.json atual em `data/history/`
     (conferido por SHA-256; nada é apagado) → põe a exportação no lugar (atômico) e confere de novo → marcador vira
     `json`. Qualquer conferência que falhe para ANTES de tocar no library.json.
  2. Só então, `STORAGE_BACKEND=json` no `.env.local` e reiniciar.
- O comando não mexe no `.env.local` e nunca sobrescreve arquivo de histórico ou exportação (nomes únicos).

Antes de qualquer rollback, também: `npm run db:backup -- --label=backup-before-rollback`.

## 5. Banco de testes

- O branch principal e o branch de testes do Neon usam o **mesmo nome de database: `neondb`**.
- O isolamento efetivo é pelo **endpoint/branch** (`ep-g…rm` principal × `ep-a…9b` testes), conferido por
  `npm run db:targets` antes de qualquer operação destrutiva e de novo imediatamente antes de cada `DROP SCHEMA`.
  Validado na FASE 2.5 (test:neon 73/73, smoke 56/56, nenhuma operação no principal).
- `NEON_TEST_DATABASE_NAME=neondb` confere o nome, mas com nomes iguais ele não distingue os dois bancos.
- Melhoria futura e independente: renomear o database do branch de testes (ex.: `testes`) e ajustar
  `NEON_TEST_DATABASE_NAME` — não feito agora; o branch de testes não foi tocado na FASE 2.5.1.

## 6. Comandos de operação

| Comando | Escreve em quê | Uso |
|---|---|---|
| `npm run db:targets` | nada | conferir URLs (mascaradas), pooler, separação principal × testes |
| `npm run db:status` | nada | versão do Postgres e migrations |
| `npm run db:verify` | nada no banco (relatório local) | JSON × Postgres, baseline, API |
| `npm run db:export` | arquivo local | Postgres → formato do library.json |
| `npm run db:backup [-- --label=…]` | arquivos locais | backup com manifesto e SHA-256 (só lê o banco) |
| `npm run state:verify` | nada | 15 perfumes / 32 imagens / Reflection contra o baseline |
| `npm run db:rollback-json [-- --confirm]` | exportação; com `--confirm`, library.json (arquivando o anterior) | volta explícita ao JSON |
| `npm run db:migrate` · `db:import` | **banco principal** | só com aprovação; exigem `db:backup` recente |
