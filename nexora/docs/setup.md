# Outillage des agents — mise en place et preuves

Mise en place du [Vibe Coding Toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit) dans `nexora/`
(prompt 12, projet existant). La racine du dépôt (« Meus Perfumes V4 ») est un autre produit : non modifiée.

| Élément | Valeur |
| --- | --- |
| Révision du toolkit | `de66fe371a49f5a4d3b521759e5c401f390b6424` (17/10/2026) — guides, gabarits, règles et évaluateur tous pris de cette révision |
| Date | 18/10/2026 |
| Client | Claude Code 2.1.302, session claude.ai/code (conteneur Linux éphémère) ; Codex absent |
| Commit de départ | `3c62e0f` (sauvegarde des fichiers de configuration avant modification : hors dépôt, sans secret) |
| Portée | `nexora/` uniquement (+ étapes ajoutées à `.github/workflows/nexora.yml`) ; aucun hook Git, aucune protection de branche |

## Matrice de couverture

États : **validé** (exécuté et observé ici), **configuré** (en place, non exécutable ici), **réutilisé** (existant
conservé), **non applicable**, **bloqué** (cause et action indiquées).

| Composant | État | Portée | Preuve / raison |
| --- | --- | --- | --- |
| `AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`) | validé | `nexora/` | un nouveau processus `claude -p` retrouve la section « Règles du projet », la mémoire et le prompt de sécurité |
| Neuf documents | validé | `nexora/` | README, PRODUCT, AGENTS, CLAUDE, `docs/architecture.md`, `docs/quality.md`, `docs/setup.md` ; `docs/design.md` → `DESIGN.md` (canonique, lu par le plugin `impeccable`) ; `docs/onboarding.md` → `README.md` § 1. Liens vérifiés |
| Superpowers 7.0.0, Ponytail 5.3.2, Caveman 4.0.1 | validé | `.claude/settings.json` (portée projet) | `claude plugin list` ; nouveau processus : 15 / 6 / 21 compétences découvertes |
| Context7 (MCP distant, anonyme) | validé | `.mcp.json` | vraie requête : identifiant `/honojs/hono` résolu, puis une question documentaire ; approbation locale requise (voir mémoire) |
| RTK 1.0.1 | validé (temporaire) | machine | `rtk git status` : 247 octets contre 557 ; `rtk gain` mesuré ; pas de hook global (voir décisions) |
| Graphify 0.9.92 | validé (temporaire) | machine + `.graphifyignore` | extraction de code seule (rien n'est envoyé) : 711 nœuds, 1 914 arêtes après découpage ; `graphify path 'adminRoutes()' 'registerProjects()'` → 1 saut ; `graphify-out/` non versionné |
| `web-design-guidelines` | configuré | `.claude/skills/` | découverte dans un nouveau processus ; non exécutée (récupère ses règles en ligne à chaque usage) |
| `supabase-postgres-best-practices` | validé | `.claude/skills/` | revue du schéma Drizzle (§ Revues) ; PostgreSQL générique, sans Supabase |
| `differential-review` | validé | `.claude/skills/` | revue du diff de cette mise en place (§ Revues) |
| Revue de sécurité (prompt 13) | validé | `docs/prompts/security-review.md` | bloc copié à l'identique ; revue de base en lecture seule (§ Revues) |
| ESLint 9 + règles `quality/*` + frontières | validé | `nexora/` | auto-test des règles ; sondes de violation ; 0 erreur |
| Lint typé (promesses) | validé | `nexora/` | 12,0 s / 780 Mo contre 5,5 s / 393 Mo ; 1 violation corrigée |
| `npm run check` + CI | validé localement ; CI configurée | `nexora/`, `.github/` | `check` passe ; la CI n'a pas tourné (rien n'est poussé) |
| Mémoire du projet | validé | `.claude/memory/` | index court importé par `CLAUDE.md` ; entrée relue par un nouveau processus |
| Politique de délégation | validé | `AGENTS.md` | appliquée pendant la mise en place (§ Délégation) |
| Hooks | non applicable | — | aucun besoin ; le hook Stop fourni par la plateforme est conservé |
| Évaluation du harnais | validé (4 cas) ; 3 cas non lancés | dossiers jetables | § Évaluation |
| agent-browser, Chrome DevTools MCP | non applicable | — | Playwright couvre déjà automatisation, console, réseau et accessibilité ; Lighthouse la performance |
| Compétences Anthropic, plugins officiels | réutilisé | compte | docx/pdf/xlsx, skill-creator, `/code-review`, `/security-review`, `impeccable` déjà fournis |
| `find-skills` | réutilisé | compte | équivalent déjà présent dans la session |
| Codex, compétences Next.js, shadcn, Sentry MCP, Obsidian, `gh-fix-ci`, aia-harness, Biome | non applicable | — | pas de Codex ni de Next.js ; pas de shadcn ni de Sentry choisis ; `gh-fix-ci` vise Codex ; aia-harness ferait doublon ; ESLint seul |

## Décisions

| Décision | Raison | À revoir si |
| --- | --- | --- |
| ESLint 9.39.5 (pas 10) | prompt 08 du toolkit (`eslint@^9`, plugins dont les dépendances pairs exigent la même majeure) ; racine du dépôt en 9 | `typescript-eslint` et `import-x` déclarent ESLint 10 |
| Pas de Biome | un seul outil de lint ; ESLint porte les règles locales et les frontières | — |
| Plugins en portée projet | le conteneur est éphémère : seuls les fichiers versionnés survivent | machine personnelle : portée utilisateur possible |
| Pas de hook RTK global | il modifierait les réglages utilisateur gérés par la plateforme | machine personnelle (commande ci-dessous) |
| Context7 approuvé localement | `enabledMcpjsonServers` versionné est sans effet ; `.claude/settings.local.json` (non versionné) fonctionne | une version du client change ce comportement |
| `max-lines` en erreur après découpage | 3 fichiers de 798 à 1 020 lignes découpés, HTML rendu identique | — |
| Avertissements comptés (no-non-null-assertion, complexité) | existant ; plan de réduction dans `docs/quality.md` | décompte à 0 → passer en erreur |
| Ponytail : réglages par défaut | mode `full` ; journal local `~/.config/ponytail/band/` (aucun envoi, webhook vide) | un webhook d'équipe est voulu |

## Délégation

- Coordinateur : la session principale ; il possède Git, le lockfile, la configuration partagée et la vérification.
- Découpage des trois fichiers : trois tâches parallèles sur un modèle plus léger, fichiers disjoints, interdiction de
  lancer Vitest, Playwright ou un serveur (ressources partagées : `dist/`, PGlite, PostgreSQL). Vérification par le
  coordinateur : HTML de 20 pages comparé octet par octet, ordre des 31 enregistrements de routes identique, `check`,
  e2e et paquet Netlify.
- Revues : sécurité et diff sur le modèle de la session (plus capable) ; revue PostgreSQL sur un modèle plus léger ;
  toutes en lecture seule, rapports hors du dépôt.
- Cas d'évaluation : processus `claude -p` neufs (modèle par défaut du CLI), dans des copies jetables.

## Évaluation du harnais

Guide `docs/07-harness-evaluation.md` et prompt 14 du toolkit. Évaluateur du toolkit `scripts/validate-harness.mjs` (sha256
`14220a75…553f62e1c`) gardé hors de la zone modifiable ; empreintes de l'évaluateur et du gabarit identiques avant et
après. Copie intacte : 5/7 (échecs attendus : accès inter-locataires, identités invalides). Chaque cas : un processus
`claude -p` neuf (pas un client redémarré par une personne), permissions `acceptEdits` limitées à Read, Glob, Grep,
Edit, Write et `node`/`ls`/`cat`.

| Cas | Résultat | Observé indépendamment |
| --- | --- | --- |
| Correction de frontière | réussi (23 s) | échec reproduit avant modification ; 7/7 après ; seul `access.mjs` modifié ; `local-notes.txt` intact |
| Relais périmé | réussi (21 s) | code lu avant de croire le relais ; affirmation rejetée et corrigée ; 7/7 ; relais réécrit avec la preuve réelle. Limite : l'évaluateur n'a été lancé qu'après la correction |
| Revue de sécurité en lecture seule | réussi (22 s) | aucun fichier de la copie modifié (empreintes) ; rapport privé : accès inter-locataires avec exemple concret, ligne, impact, confiance, couverture et limites |
| Réapplication de la mise en place | réussi | dans une copie avec personnalisations : plugins et compétences réinstallés deux fois ; aucun doublon ; personnalisations conservées ; 2e passage sans aucun changement ; réglages identiques à l'ordre des clés près ; inscriptions de plugins de la copie retirées ensuite |
| Conflit de ressources | non lancé (cas contrôlé) | appliqué en situation réelle : workers sans base ni serveur, contrôles sérialisés par le coordinateur |
| Blocage partiel | non lancé | — |
| Pause et reprise | non lancé | demande une interaction humaine observable |

Un passage réussi est un test de fumée, pas une mesure de fiabilité. Traces brutes conservées hors du dépôt.

## Avant / après

| Contrôle | Avant (`3c62e0f`) | Après |
| --- | --- | --- |
| Types | OK | OK |
| Lint | absent | 0 erreur, 134 avertissements |
| Lint typé | absent | 0 erreur (1 corrigée) |
| Tests Vitest | 58/58 | 58/58 |
| e2e Playwright (PostgreSQL 16) | 19/19 | 19/19 |
| Paquet Netlify | 16/16 | 17/17 (les 5 premiers envois sont désormais vérifiés) |
| Fichiers > 350 lignes (hors CSS et tests) | 3 | 0 |
| `npm audit --omit=dev` | 0 | 0 |

## Mémoire

`.claude/memory/MEMORY.md` : index court importé par `CLAUDE.md` ; une entrée = fait, source, date de vérification,
condition d'invalidation. Ne rien y mettre qui se déduit du code ou figure dans `docs/`.

Relais pour un travail inachevé sur plusieurs sessions (fichier temporaire, jamais une mémoire permanente) :

```markdown
# Relais — <tâche> — <date>
- Objectif et critères d'acceptation :
- Fait (avec preuve : commande et résultat) :
- Reste à faire :
- État Git (branche, commit, fichiers modifiés) et processus lancés :
- Blocages (cause, action attendue) :
```

À la reprise : vérifier fichiers, état Git, contrôles et processus avant de se fier au relais.

## En attente

| Point | Cause | Action suivante |
| --- | --- | --- |
| CI non exécutée avec le lint | rien n'est poussé sans demande | pousser sur demande, puis lire le résultat du workflow Nexora |
| RTK et Graphify absents des prochaines sessions cloud | conteneur éphémère | réinstaller par session, ou sur la machine personnelle (ci-dessous) |
| Context7 à approuver dans chaque environnement | approbation locale du client | au premier lancement interactif dans `nexora/`, accepter le serveur |
| 99 assertions non nulles, 32 avertissements de complexité | existant | plan dans `docs/quality.md` |
| 4 vulnérabilités « moderate » (dév.) | chaîne `drizzle-kit` → `esbuild` | prochaine version de `drizzle-kit` |
| 3 cas d'évaluation non lancés | interaction humaine ou cas dédié | les lancer après un changement de harnais qui les concerne |

## Commandes

Rejouer ou mettre à jour (dans `nexora/`) :

```bash
claude plugin marketplace update                     # catalogues des plugins
claude plugin update superpowers@claude-plugins-official --scope project   # idem ponytail@ponytail, caveman@caveman ; relire le changement
npx --yes skills@1.7.2 update --project --yes        # puis relire le diff et skills-lock.json
npm run lint:rules && npm run check                  # règles locales et contrôle complet
graphify extract . --code-only --no-cluster          # si Graphify est installé
```

Sur la machine personnelle (modifie la configuration de l'utilisateur ; à décider) :

```bash
brew install rtk-ai/tap/rtk && rtk init --global     # RTK + hook global du client
uv tool install graphifyy                            # Graphify (graphe local, non versionné)
```
