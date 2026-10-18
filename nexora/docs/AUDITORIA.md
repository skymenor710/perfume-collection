# Auditoria inicial — site Nexora (18/10/2026)

Auditoria feita **antes de qualquer modificação**, no código do repositório (`nexora/`, branch `claude/nexora-site`,
commit `26a8e44`) e no site executado localmente (servidor de desenvolvimento em `:3000`, build de produção em `:3200`).
O artifact <https://claude.ai/artifact/9PAkSjTMTnpPiDmBmyQUeL> é um instantâneo estático gerado a partir deste mesmo
código (`scripts/snapshot.mjs`); a auditoria foi feita na fonte, não numa cópia.

## Método e ferramentas

| Verificação | Ferramenta | Escopo |
| --- | --- | --- |
| Capturas de tela | Playwright 1.63 + Chromium | 5 páginas (início, mentions légales, politique de confidentialité, login admin, 404) × 3 larguras (1440, 834, 390 px) |
| Acessibilidade | axe-core 4.13 (`@axe-core/playwright`), regras WCAG 2.0/2.1/2.2 A e AA + boas práticas | as mesmas 15 combinações |
| Console, requisições com falha, overflow horizontal, alvos de toque < 24 px, imagens sem `alt`, hierarquia de títulos, metadados | script próprio (`scratchpad/audit/audit.mjs`) | as mesmas 15 combinações |
| Links internos e âncoras | `fetch` de cada link encontrado | todos os links das 5 páginas |
| Desempenho / boas práticas / SEO | Lighthouse 12.8.2 (mobile e desktop), build de produção | página inicial |
| Dependências | `npm audit` e `npm audit --omit=dev` | árvore completa |
| Referências | Playwright (somente leitura: carregar a página inicial e rolar) | metalab.com, locomotive.ca, pentagram.com |
| Código | leitura manual | rotas, segurança, formulário, admin, CSS, JS cliente, configuração |

Evidências guardadas em `docs/audit/` (capturas `avant-*.webp`, relatório axe bruto `avant-axe-rapport.json`).

## Pontos fortes verificados (não mexer sem motivo)

- **Lighthouse 100 / 100 / 100 / 100** em mobile e desktop. Mobile: LCP 1,5 s, CLS 0, TBT 0 ms. Desktop: LCP 0,34 s.
- **axe: 0 violações** nas 15 combinações página × largura (inclui WCAG 2.2 AA).
- Nenhum erro de console (exceto o 404 esperado na página 404), nenhuma requisição com falha, **nenhum overflow
  horizontal**, nenhum alvo de toque < 24 px, todas as imagens com `alt`, um único `h1` por página.
- Todos os links internos respondem 200; todas as âncoras existem.
- Segurança: CSP estrita sem `unsafe-inline` (CSS inline autorizado por hash SHA-256), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS quando em https. Admin: scrypt, sessões no
  servidor, CSRF, cookies `__Host-`, limitação de tentativas. Contato: honeypot, token assinado com tempo mínimo,
  limitação por IP (HMAC), validação zod no servidor, mensagem de sucesso **só depois da gravação**.
- `npm audit --omit=dev`: **0 vulnerabilidades** nas dependências de produção.
- HTML da página inicial: 22 KB com compressão; 576 nós DOM; imagens AVIF/WebP responsivas com `width`/`height`.

## Problemas observados (com evidência)

| # | Severidade | Problema | Evidência | Correção proposta |
| --- | --- | --- | --- | --- |
| O1 | **Alta** (para Netlify) | O projeto não é implantável na Netlify tal como está: servidor Node de longa duração (`main.ts`, `serve()` + `setInterval`), banco PGlite e armazenamento em disco local por padrão, e o IP do cliente vem de `getConnInfo` do `@hono/node-server`. Numa função serverless esse IP vira `unknown` para todos os visitantes → a limitação de envio do formulário (5 por 15 min) passaria a valer **para o site inteiro**. | `src/server/main.ts`, `src/server/lib/security.ts` (`clientIp`), `src/server/config.ts` | Função Netlify que reaproveita o mesmo app Hono, IP vindo de `context.ip`, recusa explícita de PGlite / disco local em serverless, limpeza periódica via função agendada, `netlify.toml`. |
| O2 | Média | Em tablet (834 px), a ilustração decorativa da seção Contato (porta luminosa) fica **atrás do texto de introdução** e reduz a legibilidade (“nous revenons vers vous… prochaines étapes”). O axe não detecta (contraste sobre imagem). | `docs/audit/avant-tablette-contact.webp` | Reposicionar/atenuar a ilustração entre 700 e 1100 px. |
| O3 | Média | O portfólio aparece só na 4ª seção (~2 500 px abaixo do topo no desktop) e cada caso tem ~110 palavras em três blocos; navegar pelas capturas exige abrir a visionneuse (não há setas, deslize nem indicadores no próprio card). | `docs/audit/avant-bureau.webp`; `home.tsx` (`CaseStudy`) | Seção “Nos réalisations” logo após o hero, três cards com galeria própria (setas, teclado, swipe, indicadores), texto resumido + detalhes recolhíveis. |
| O4 | Média (SEO local) | Nenhuma menção a Romorantin-Lanthenay, Blois ou Orléans no HTML (0 ocorrências); JSON-LD só `Organization`, sem `areaServed` nem serviços; o `h1` não contém “création de sites web”. | `curl / \| grep` → 0; relatório de metadados | Hero e título focados em “création de sites web”, zona de atuação configurável (texto + JSON-LD `ProfessionalService.areaServed`), pergunta de FAQ sobre a zona — sem páginas artificiais nem endereço inventado. |
| O5 | Baixa | Tipografia francesa: espaço normal antes de `?` `:` `;` `!` → pontuação órfã na quebra de linha (ex.: “Comment se déroule la collaboration / ?” no mobile). | `docs/audit/avant-mobile.webp` (FAQ) | Espaço fino inseparável (U+202F) aplicado aos textos do conteúdo e dos projetos. |
| O6 | Baixa | Títulos em duas linhas sem espaço entre as linhas no texto: “Nos concepts de sites**à** forte conversion”, “Votre prochain site**commence** ici” (lido assim por buscadores e copiar/colar). | extração de títulos no relatório axe | Espaço explícito entre as duas linhas. |
| O7 | Baixa | As *Mentions légales* afirmam “aucun outil de mesure d’audience” mesmo quando o Plausible está configurado (a página não recebe essa informação). | `legal.tsx` (`LegalNotice`) | Passar o estado da medição de audiência às mentions légales. |
| O8 | Baixa | As animações de entrada escondem o conteúdo (`opacity: 0`) até o IntersectionObserver disparar. Numa captura com rolagem rápida o conteúdo ficou invisível; na impressão não há plano B. | `scratchpad/audit/before/desktop_.png` (seções vazias) | Revelar tudo em `beforeprint` e revelar elementos já ultrapassados. |
| O9 | Baixa | `npm audit`: 4 vulnerabilidades *moderate* só em desenvolvimento (drizzle-kit → @esbuild-kit → esbuild ≤ 0.24.2, GHSA-67mh-4wv8-2f99, servidor de dev do esbuild). Não há correção sem quebrar o drizzle-kit; o drizzle-kit não inicia esse servidor. | saída do `npm audit` | Aceitar e monitorar (não afeta produção). |
| O10 | Info | Os três projetos não têm URL pública (campo vazio) → nenhum link “Voir le site”. Na sua conta existem artifacts publicados “EARKO SecureFit Ear Clips” e “AWM Biotech”, **privados por padrão**; o nome AWM foi desfocado de propósito nas capturas. | `Artifact list` | Não vincular sem a sua decisão (compartilhamento público + confidencialidade). O campo URL já existe no admin. |
| O11 | Info | As capturas do conceito de maçonnerie mostram dados do site-conceito (“QUALIBAT · RT 2020”, “4,6 / 5 · 20 avis Google”, “Depuis 2016”). Estão marcadas “Concept / Démonstration”, mas, se não forem dados reais da empresa prospectada, podem induzir em erro. | `docs/audit/avant-bureau.webp` | Confirmar com você; se forem fictícios, refazer a captura com esses números desfocados. |
| O12 | Info | Testes E2E: um único projeto Playwright (desktop) e nenhum teste automatizado de acessibilidade. | `playwright.config.ts` | Projetos desktop + mobile e teste axe na suíte. |
| O13 | Info | `sitemap.xml` sem `lastmod`; `og:image` sem `alt`. | `/sitemap.xml`, `<head>` | Acrescentar. |

## Diferenças em relação ao pedido (não são defeitos)

- CTA principal atual “Demander un diagnostic”; pedido: **“Demander un devis”** + secundário **“Voir nos réalisations”**.
- Serviços atuais: 4 (vitrines, refonte, e-commerce, automatisations); pedido: **5** (création, refonte, responsive,
  performances, maintenance).
- Processo atual: 3 etapas; pedido: **4** (découverte, conception, développement, mise en ligne).
- Título da seção de projetos: “Nos concepts de sites à forte conversion”; pedido: **“Nos réalisations”**. Os três
  projetos são trabalhos feitos pela Nexora sem encomenda de cliente: continuarão marcados “Concept / Démonstration”,
  com uma frase que o diz claramente (nenhum resultado ou cliente inventado).

## Comparação crítica com as referências (somente leitura)

| | Metalab | Locomotive | Pentagram | Nexora hoje |
| --- | --- | --- | --- | --- |
| Primeira tela | uma frase curta em serifa grande, lista de clientes como navegação | vídeo + nome, “Featured work” logo abaixo | trabalho em destaque, frase “We design X for Y” | promessa longa (4 linhas), símbolo N em destaque |
| Lugar do portfólio | imediato | 2ª tela | imediato | 4ª seção |
| Legendas dos trabalhos | nome do cliente | nome do projeto | nome + uma linha | três parágrafos rotulados |
| CTA | “Get in touch” discreto e permanente | “Let’s talk” permanente | “Contact” | “Demander un diagnostic” permanente + formulário visível |
| Prova | marcas conhecidas | marcas + prêmios | 50 anos de projetos | nenhuma (não há clientes publicados — correto não inventar) |

Lições aplicáveis **sem copiar** código nem identidade: dizer menos e mostrar o trabalho mais cedo; legendas curtas com
o detalhe sob demanda; um único CTA principal repetido com coerência. O que a Nexora faz melhor que as referências para
o público PME: processo explícito, FAQ, formulário visível e transparência sobre o estatuto dos projetos — manter.

## Sugestões (não são problemas)

- S1. Animações: o projeto não usa React, portanto **Framer Motion não é compatível**. A biblioteca `motion` (API
  JavaScript) é compatível, mas o comportamento pedido (revelação no scroll, transições, micro-interações, respeito a
  `prefers-reduced-motion`) já está implementado com IntersectionObserver + CSS, 0 KB extra. Recomendação: não
  acrescentar a dependência; refinar as micro-interações em CSS.
- S2. Banco de dados: é necessário (formulário gravado antes da confirmação, admin, sessões, limitação de envio).
  Recomendação: manter PostgreSQL (Neon ou “Netlify DB”, que usa Neon) — não há base desnecessária.
- S3. Imagens no admin via Netlify: funções síncronas têm limite de ~6 MB por requisição e 10 s de execução (26 s em
  planos pagos); o tratamento AVIF de várias imagens grandes pode ultrapassar. Recomendação: enviar uma imagem por vez,
  limite de upload em 5 MB nessa plataforma, e documentar.
- S4. Prova social: quando houver clientes reais, publicar como “Projet client” (o admin já separa conceitos e
  resultados) e acrescentar depoimentos reais com autorização escrita.

## Plano de implementação (fases 2 a 5)

1. Hero: título sobre criação de sites premium, subtítulo curto, “Demander un devis” → formulário, “Voir nos
   réalisations” → portfólio; reserva de horário mantida na seção Contato quando configurada.
2. “Nos réalisations” logo após o hero: três cards com galeria independente (setas, teclado, swipe, indicadores
   acessíveis, lazy loading, sem layout shift), visionneuse mantida, honestidade sobre conceitos.
3. Serviços (5) e processo (4 etapas), editáveis no admin.
4. Correções O2, O5–O8, O13; acessibilidade mantida.
5. SEO: títulos/meta/OG, JSON-LD `ProfessionalService` com zona de atuação, FAQ local, sitemap `lastmod`.
6. Netlify: função que reaproveita o app, IP confiável da plataforma, função agendada de limpeza, `netlify.toml`,
   documentação, teste automatizado do handler.
7. Testes: unitários, E2E desktop + mobile, axe automatizado, Lighthouse, medição de latência de interação (proxy de
   INP em laboratório), `npm audit`.
