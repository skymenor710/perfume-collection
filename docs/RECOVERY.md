# Recuperação — Meus Perfumes

> Para emergências. Estado de referência: 28/09/2026 — coleção no Postgres do Neon (`STORAGE_BACKEND=postgres`),
> 1 usuário, 15 perfumes, 4 versões, 15 imagens de produto (32 arquivos: grande/pequeno/mestre), schema `0000_inicial`.
> Nada aqui contém credencial. As URLs do banco vivem só no `.env.local` deste computador (e no painel do Neon).

## Antes de tudo: o que NÃO fazer numa emergência

1. **Não apagar nada** — nem pastas de `data/`, nem backups, nem o branch do Neon. Primeiro copiar, depois pensar.
2. **Não ligar `STORAGE_BACKEND=json` "para ver se volta".** O `data/library.json` está PARADO desde 28/09/2026
   (SHA-256 `0c63c753…`); tudo que o app gravou depois está só no Postgres. O app, aliás, recusa essa partida.
3. **Não copiar o `library.json` histórico por cima de nada** e não usar `db:import --allow-update` com ele: isso
   reescreveria o Postgres com dados antigos.
4. **Não rodar `db:migrate` nem `db:import` no banco principal sem `npm run db:backup` antes** (os comandos exigem).
5. **Não usar o branch de testes do Neon como fonte de dados** — ele é apagado e recriado pelos testes.
6. **Não colar URLs do banco em chat, e-mail, documento ou Git.** Se vazar: trocar a senha no painel do Neon.
7. **Não "consertar" divergência na mão.** Comparar primeiro (`npm run db:verify`), decidir depois.

## 0) Recuperar o código (bundle do Git)

O repositório não tem remoto: o código inteiro, com o histórico, vai no pacote externo como `codigo-<commit>.bundle`
(OneDrive → `Backups/MeusPerfumes/`). Usar o bundle do **mesmo commit** que o `VERSION.json` do pacote (`gitCommit`).

1. `git bundle verify codigo-<commit>.bundle` → tem de dizer que está ok.
2. `git clone -c core.autocrlf=false codigo-<commit>.bundle perfume-collection` — o `-c core.autocrlf=false` é
   obrigatório neste Windows: o Git global está com `autocrlf=true` e, sem ele, todos os arquivos voltam com CRLF e deixam de
   ser byte a byte os do commit (as migrations, inclusive).
3. `git log -1 --oneline` = o commit do bundle; `npm ci`; `npm run typecheck`; `npm test`.

⚠️ **`codigo-8a5d91c.bundle` (pacote `recovery-20260928-192903`) está incompleto para o frontend:** até a correção de
28/09/2026 (FASE 2.5.4) a regra `data/` do `.gitignore` escondia também `apps/web/src/data/` (`repository.ts`,
`claude.ts`, `seed.json`), que nunca entrou no Git. Com ele, banco, API e imagens se recuperam, mas `npm run build` e os testes
falham. Usar um bundle de commit posterior (o do pacote mais recente, que foi restaurado e compilado do zero).

**O que não está em pacote nenhum (de propósito) e como volta:**

| Item | Como volta |
|---|---|
| `.env.local` (URLs do banco, código de acesso) | `npm run db:configure` com as URLs do painel do Neon; o código de acesso é gerado de novo na primeira partida |
| `data/devices.json` (celulares pareados) | parear os aparelhos de novo |
| Modelo de IA do recorte (`data/models`, 224 MB) | baixado sozinho na primeira importação, do commit fixado no código e conferido pelo SHA-256 |
| `data/cache`, `data/logs` | descartáveis |
| `assets/masters/` (mestres da planilha) | `npm run seed:research` (as fotos em uso estão no pacote) |

## A) Recuperar a partir do Postgres (o normal)

O Postgres do Neon É a fonte oficial. Se o computador ou o app quebrou, os dados continuam lá.

1. Recuperar o código (seção 0) e `npm ci`.
2. Recriar o `.env.local` com `npm run db:configure` (as URLs vêm do botão *Connect* do painel do Neon) e
   `STORAGE_BACKEND=postgres`.
3. `npm run db:targets` → confere as URLs (mascaradas) e a separação principal × testes.
4. `npm run db:status` → conexão e migrations (`0000_inicial` aplicada).
5. `npm run db:export` → gera uma cópia local em `data/exports/` (primeira coisa a guardar).
6. Restaurar as imagens (seção C) — elas NÃO estão no banco.
7. `npm run app` → o app sobe lendo do Postgres; conferir 15 perfumes na tela.

Se o banco do Neon foi alterado por engano: o Neon guarda um histórico de restauração (restore/branch a partir de um
instante no passado, pelo painel). Restaurar para um branch NOVO, conferir com `db:verify`, e só então decidir.

## B) Recuperar a partir de um export (sem o Neon, ou para recriar o banco)

Um pacote de recuperação (`data/backups/recovery/recovery-*/`) tem `postgres-export.json` — a coleção inteira no
formato do `library.json`, conferida com o Neon quando foi gerada (`manifest.json`).

**Para um banco Postgres novo (vazio):**

1. Conferir o pacote: SHA-256 de cada arquivo = `manifest.json` (seção "Conferir um pacote").
2. Configurar a URL do banco novo (`npm run db:configure`).
3. `npm run db:backup` (exigido antes de gravar) → `npm run db:migrate` (cria o schema `0000_inicial`).
4. `npm run db:import -- --file=<pacote>/postgres-export.json --dry-run` → ensaio (desfaz tudo).
5. `npm run db:import -- --file=<pacote>/postgres-export.json` → transação única, verificada campo a campo antes do
   COMMIT; se algo falhar, ROLLBACK e nada fica pela metade.
6. `npm run db:verify -- --against=<pacote>/postgres-export.json` → 0 diferenças.

**Para voltar ao JSON a partir do export:** ver D.

## C) Recuperar as imagens (pelos SHA-256)

As fotos moram em disco, não no banco: `data/media/` (importadas) e `apps/web/public/bottles/` (planilha).
O banco guarda só a REFERÊNCIA (`media/…`, `bottles/…`) e o SHA-256 da imagem principal.

1. No pacote, `images/` tem os arquivos com o mesmo caminho relativo da referência, e `images-inventory.json` lista
   cada um: referência, caminho, tamanho, formato, SHA-256 e a que perfume/versão pertence.
2. Copiar `images/media/*` → `data/media/` e `images/bottles/*` → `apps/web/public/bottles/`.
3. Conferir: o SHA-256 de cada arquivo copiado tem de ser igual ao do inventário. Arquivo com hash diferente NÃO serve
   (é outra imagem ou está corrompido) — procurar outra cópia com o hash certo.
4. `npm run state:verify` (com o library.json de referência) ou `npm run db:verify` → as 32 imagens conferem.

## D) Voltar para o JSON (explícito, nunca automático)

Só com o Postgres acessível — a volta usa os dados DE AGORA do Postgres, não o library.json histórico.

1. `npm run db:backup -- --label=backup-before-rollback`
2. `npm run db:rollback-json` → ensaio: exporta o Postgres e confere; não mexe em nada.
3. `npm run db:rollback-json -- --confirm` → exporta e confere, **arquiva** o `data/library.json` atual em
   `data/history/`, põe a exportação no lugar, confere de novo e muda o marcador `data/storage-backend.json` para json.
4. Só então `STORAGE_BACKEND=json` no `.env.local` e reiniciar (`npm run app:stop` → `npm run app`).

⚠️ **O `library.json` histórico (SHA-256 `0c63c753…`) não deve ser usado como fonte atual** depois de qualquer
alteração no Postgres: ele não tem nada do que foi gravado após 28/09/2026. Com o marcador dizendo "postgres", o app
se recusa a subir em JSON exatamente para impedir isso.

Se o Postgres NÃO estiver acessível: o rollback não roda. Usar o `postgres-export.json` do pacote de recuperação mais
recente — conferir o SHA-256 com o `manifest.json`, arquivar o `data/library.json` atual (copiar para
`data/history/`), copiar o export para `data/library.json`, ajustar o marcador para `json` e só então trocar o
`STORAGE_BACKEND`. Tudo que foi gravado depois da data do pacote estará perdido — por isso o pacote precisa ser recente.

## Conferir um pacote de recuperação

- `manifest.json` lista cada arquivo com tamanho e SHA-256; recalcular (`Get-FileHash` no PowerShell,
  `sha256sum` no Git Bash) e comparar.
- `postgres-export.json`: 1 usuário, 15 produtos, 15 entradas (no estado de 28/09/2026).
- `images/`: 32 arquivos, hashes iguais ao `images-inventory.json`.
- Nenhum arquivo do pacote contém URL de banco, senha ou código de acesso (verificado na geração).

## Ensaio de restauração completo (feito em 28/09/2026, FASE 2.5.4)

Usando **só** a cópia do OneDrive, num diretório temporário fora do projeto, sem `.env.local` e sem nenhuma URL do Neon no
ambiente: código ← bundle (seção 0) → `npm ci` → imagens ← `images/` do pacote → PGlite descartável
(`DATABASE_URL=pglite:<pasta>`) → `db:migrate` → `db:import` (ensaio e real) → `db:verify --against=postgres-export.json`
→ `npm run build` → servidor com `STORAGE_BACKEND=postgres` → API por HTTP. Resultado: banco restaurado = export (0
diferenças), API byte a byte = baseline, Reflection ok, 32 imagens com o SHA-256 do inventário. Foi esse ensaio que achou
o problema do `.gitignore` e o do `autocrlf` descritos na seção 0.
