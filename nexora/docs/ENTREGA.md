# Entrega — auditoria e melhorias do site Nexora (18/10/2026)

Branch `claude/nexora-site` · pasta `nexora/` · pré-visualização: <https://claude.ai/artifact/9PAkSjTMTnpPiDmBmyQUeL>
(instantâneo estático do site: o formulário não envia a partir da pré-visualização).

## 1. Relatório da auditoria inicial

Completo em [`docs/AUDITORIA.md`](AUDITORIA.md), com evidências em `docs/audit/` (capturas `avant-*.webp`, relatório axe
bruto). Resumo: o site já tinha Lighthouse 100×4 e 0 violações axe; os problemas observados eram a impossibilidade de
publicar na Netlify tal como estava (com risco de a limitação do formulário valer para o site inteiro), a ilustração
da seção Contato sobre o texto em tablet, o portfólio tarde demais e pesado de ler, SEO local inexistente, tipografia
francesa (pontuação órfã), títulos sem espaço entre linhas e uma frase das mentions légales incorreta quando a medição
de audiência está ativa.

## 2. Mudanças implementadas

| Área | Mudança |
| --- | --- |
| Hero | Título « Création de sites web **premium** pour les PME. », subtítulo de benefício curto, zona de atuação, CTA principal **« Demander un devis »** (sempre o formulário) e secundário **« Voir nos réalisations »**. Símbolo N com néon só na faixa vinho, mantido. |
| Portfólio | Seção **« Nos réalisations »** logo após o hero; 3 cards com **galeria independente** (setas, pontos indicadores acessíveis, ← → Início Fim, deslize no celular, lazy loading, altura fixa sem layout shift), resumo de uma frase, detalhe recolhível (contexto, solução, objetivo de conversão / resultados), badge de estatuto, botão « Plein écran » que abre a visionneuse na captura exibida. Projetos clientes passam automaticamente à frente dos conceitos. |
| Serviços | 5 serviços pedidos (criação, refonte, responsive, performances, manutenção), cada um leva ao formulário com o tipo de projeto pré-selecionado. |
| Processo | 4 etapas: Découverte, Conception, Développement, Mise en ligne. |
| Navegação | Réalisations · Services · Processus · FAQ · Contact (o logo volta ao topo). |
| Contato | Formulário inalterado (já validava no cliente e no servidor, antispam, limitação, sucesso só após gravação); tipos de projeto alinhados com os serviços; reserva de horário só na seção Contato, quando configurada; ilustração reposicionada em tablet. |
| SEO | Título e descrição com « création de sites web » e as cidades; JSON-LD `ProfessionalService` + `WebSite` com zona de atuação e os 5 serviços (endereço, telefone e e-mail só se realmente preenchidos); pergunta de FAQ sobre Romorantin-Lanthenay, Blois e Orléans; zona no rodapé; `lastmod` no sitemap; sem páginas artificiais por cidade. |
| Tipografia | Espaços inseparáveis franceses aplicados na exibição (sem alterar o texto salvo no admin). |
| Animações | Revelação no scroll mais robusta (revela também o que um salto de âncora ultrapassou, e tudo na impressão); micro-interações em CSS; visionneuse sem desfoque invisível (abertura 120 → 48 ms). Framer Motion não é compatível (não há React); a biblioteca `motion` seria compatível mas desnecessária (comportamento já obtido com IntersectionObserver + CSS, 0 KB). |
| Netlify | `netlify.toml`, função `site` (mesma aplicação Hono), função agendada de limpeza, IP do visitante vindo da plataforma, recusa explícita de PGlite / disco local, migrações no build, `npm run test:netlify`. |
| Admin | Formulário de conteúdos atualizado (CTA, 5 serviços, 4 etapas, 7 perguntas, zonas atendidas, rótulos de « Nos réalisations »); avisos do painel ajustados. |
| Legal | Mentions légales coerentes com a medição de audiência configurada. |

## 3. Site atualizado

- Local: `cd nexora && npm ci && cp .env.example .env` (preencher `SESSION_SECRET`), `npm run build`, `npm run db:seed`,
  `npm run admin:create -- --email …`, `npm start` → <http://localhost:3000>.
- Pré-visualização publicada (versão 6): <https://claude.ai/artifact/9PAkSjTMTnpPiDmBmyQUeL>.
- Capturas depois das mudanças: `docs/audit/apres-bureau.webp`, `apres-tablette.webp`, `apres-mobile.webp`.

## 4. Resultados dos testes (executados de verdade, 18/10/2026)

| Verificação | Resultado |
| --- | --- |
| TypeScript estrito | 0 erro |
| Vitest (integração) | 58 / 58 |
| Playwright em PostgreSQL 16.15 | 19 / 19 (desktop 15, mobile Pixel 7 4) |
| axe-core 4.13, WCAG 2.2 AA | 0 violação em 5 páginas × 3 larguras + estados abertos |
| Lighthouse 12.8.2 mobile | 100 / 100 / 100 / 100 — LCP 1,4 s, CLS 0, TBT 30 ms |
| Lighthouse 12.8.2 desktop | 100 / 100 / 100 / 100 — LCP 0,4 s, CLS 0, TBT 0 ms |
| Latência de interações (proxy de laboratório do INP) | < 200 ms em todas as interações testadas |
| Pacote de funções Netlify | 16 / 16 controles |
| `npm audit --omit=dev` | 0 vulnerabilidade |
| Links internos | todos 200 |

Detalhes e limites (laboratório ≠ visitantes reais; INP de campo só após publicação): [`docs/RAPPORT.md`](RAPPORT.md).
Relatórios Lighthouse: `reports/lighthouse/{mobile,desktop}.html`.

## 5. Pendências e causas

| Pendência | Causa |
| --- | --- |
| Publicação na Netlify não feita | Sem conta nem autorização para publicar ou contratar serviços; a configuração foi testada localmente com o pacote gerado como na Netlify, não num deploy real. |
| Banco PostgreSQL (Neon), bucket R2/S3, domínio, e-mail transacional | Credenciais externas inexistentes nesta sessão (lista em `docs/A-COMPLETER.md`). |
| Dados legais (razão social, SIRET, endereço, hospedagem, prazo de conservação) | Não fornecidos; as páginas mostram « À compléter » — nada foi inventado. |
| Zona de atuação e modo de atendimento (visio / telefone / e-mail) | Escritos a partir do seu pedido de SEO local: confirmar ou corrigir no admin. |
| Links « Voir le site » dos conceitos | Seus artifacts « EARKO SecureFit Ear Clips » e « AWM Biotech » existem, mas são privados por padrão e o nome AWM foi desfocado de propósito; não liguei sem sua decisão. |
| Números visíveis nas capturas do conceito de maçonnerie (QUALIBAT, 4,6/5, desde 2016) | Precisam ser confirmados como dados reais da empresa ou desfocados. |
| Clientes, depoimentos, números de prova | Não existem dados reais: as seções ficam ocultas até serem preenchidas no admin. |
| 4 vulnerabilidades « moderate » em ferramenta de desenvolvimento (drizzle-kit) | Sem correção disponível sem quebrar a ferramenta; não afeta a produção. |
| Teste com leitor de tela real (VoiceOver / NVDA) | Não disponível neste ambiente; o axe não substitui esse teste. |

## 6. Execução e deploy na Netlify

Execução local: seção 3 acima e README § 1. Deploy: README § 3 bis, resumido:

1. Criar um PostgreSQL (Neon) e um bucket R2/S3 com chave limitada a esse bucket.
2. Netlify → importar o repositório, **Base directory** `nexora` (o resto vem de `netlify.toml`).
3. Variáveis (escopos Builds e Functions): `NODE_ENV=production`, `PUBLIC_URL`, `SESSION_SECRET`, `DATABASE_URL`,
   `STORAGE_DRIVER=s3` + `S3_*`, `UPLOAD_MAX_MB=4`; opcionais `MAIL_*`, `ANALYTICS_*`.
4. Deploy (o build aplica as migrações e recusa banco não PostgreSQL), depois criar o administrador com
   `npm run admin:create` apontando para o banco de produção.
5. Limites: requisições de 6 MB (enviar imagens uma a uma) e 10 s de execução por padrão.

## 7. Guia para adicionar novos projetos ao portfólio

1. `/admin` → **Projets** → **Nouveau projet**.
2. Nome, categoria, **descrição curta** (o resumo do card), endereço do site **real e público** (opcional).
3. Contexto/desafio e solução.
4. Projeto de cliente: desmarcar *Concept de démonstration*, preencher **resultados verificáveis** (com acordo do
   cliente) e **depoimento** (citação exata, nome e função, acordo escrito). Conceito: preencher o objetivo de conversão.
5. Enviar as capturas 16:10 (ideal 2880 × 1800), **uma de cada vez na Netlify**, com o texto alternativo de cada uma;
   a primeira é a capa.
6. Escolher a posição de destaque (1 a 3), marcar **Publié**, salvar: o card aparece em « Nos réalisations » com a sua
   galeria, sem tocar no código.
