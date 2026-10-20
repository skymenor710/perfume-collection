# Qualité et contrôles

Ce que chaque commande prouve, les règles adoptées et leurs décomptes, la stratégie de test. Mesures du 18/10/2026
dans le conteneur Linux de développement (Node 22, 4 Go) ; les durées dépendent de la machine.

## Commandes

| Commande | Ce qu'elle prouve | Ce qu'elle ne prouve pas | Mesure |
| --- | --- | --- | --- |
| `npm run typecheck` | TypeScript strict sans erreur (`noUnusedLocals`, `noUnusedParameters`, JSX Hono) | le comportement | — |
| `npm run lint` | ESLint 9 sans types : recommandations JS, `typescript-eslint` strict, imports résolus et sans doublon, frontières d'architecture, règles locales `quality/*`, budget de taille et de complexité | promesses mal gérées (voir ligne suivante) | 5,5 s, 393 Mo |
| `npm run lint:typed` | même jeu + `no-floating-promises` et `no-misused-promises` (avec le vérificateur de types) | — | 12,0 s, 780 Mo |
| `npm run lint:rules` | les 3 règles locales (`eslint-rules/`) signalent ce qu'elles doivent et seulement cela (auto-test du Vibe Coding Toolkit) | — | < 2 s |
| `npm test` | 67 tests d'intégration Vitest sur PGlite en mémoire : routes publiques et admin (dont la protection de chaque route d'admin énumérée), sécurité (CSRF, sessions, limitation de débit sans déni de service, IP derrière proxy, en-têtes, CSP, journal sans données), contenus, images, renvoi des notifications | le navigateur réel, PostgreSQL serveur | ~2 min |
| `npm run build` | le JS/CSS du navigateur se construit (Vite) | — | < 2 s |
| `npm run check` | enchaîne lint, types, lint typé, règles, tests, build ; ne publie rien, ne migre rien | e2e, paquet Netlify | 147 s, 1,3 Go max |
| `npm run test:e2e` | 19 scénarios Playwright (desktop + mobile émulé) sur le build : parcours, formulaire, admin, axe WCAG 2.2 AA, latence des interactions ; sur PostgreSQL avec `E2E_DATABASE_URL` | rendu d'autres navigateurs que Chromium | 3,1 min (PostgreSQL 16) |
| `npm run test:netlify` | le paquet des fonctions Netlify s'empaquette et répond : 17 vérifications (routes, contact, limitation, IP falsifiée, fonction planifiée) sur PostgreSQL | un vrai déploiement Netlify | < 1 min |
| `npm audit --omit=dev` | aucune vulnérabilité connue dans les dépendances de production (0 au 18/10/2026) | dépendances de développement (voir § Dépendances) | — |

La CI (`.github/workflows/nexora.yml`) s'exécute sur chaque PR touchant Nexora, ainsi que sur les pushes vers `main` et
la branche de production `claude/nexora-site`. Elle exécute : audit de production, lint, types, lint typé, règles,
tests, build, e2e et paquet Netlify sur un PostgreSQL 16 éphémère. Aucun secret, aucun déploiement.

## Contrôle de la production

Netlify publie automatiquement la branche de production à chaque push (build : `npm run build`, migrations en
contexte `production`, `/version.txt`). Après chaque déploiement :

- `https://nexora-creation.fr/version.txt` affiche le commit attendu (sinon le build a échoué : le site précédent reste
  en ligne ; voir *Deploys* dans Netlify).
- Pages (`/`, pages légales, `/admin/connexion`, 404), redirections (`http`, `www`, `nexora-creation.netlify.app` →
  `https://nexora-creation.fr`), en-têtes de sécurité, aucun en-tête CORS.
- Formulaire : autre origine → 403, jeton forgé → 400, champ invalide → 422, envoi valide → 201 (demande de test à
  supprimer ensuite dans l'admin ; 5 envois par IP et par 15 min).
- Lighthouse mobile et desktop ; axe (WCAG 2.2 AA) à 390 et 1440 px.

Dernier contrôle : 19/10/2026, commit `9873e0b` — 30/30 vérifications ; Lighthouse 100 / 100 / 100 / 100 en mobile et
en desktop (LCP mobile 1,3 s, CLS 0,03, 75 Ko transférés) ; axe : 0 violation sur 5 pages × 2 largeurs, aucune erreur
console, aucun débordement horizontal.

## Règles ESLint

Configuration : `eslint.config.mjs` (rapide) et `eslint.config.typed.mjs` (avec types). Profil adapté du Vibe Coding
Toolkit (révision `de66fe3`) ; règles locales copiées à l'identique dans `eslint-rules/`. Politique d'adoption : une
règle sans violation est une erreur ; une règle avec un existant est un avertissement compté, avec un plan de réduction.
Jamais de seuil relevé, d'exclusion large ou de suppression générique pour faire passer un contrôle.

| Règle | Gravité | Décompte à l'adoption → actuel | Note |
| --- | --- | --- | --- |
| `quality/max-lines` (350 lignes, hors CSS) | erreur | 3 → 0 | `routes/admin.tsx`, `views/admin/pages.tsx`, `views/site/home.tsx` découpés par responsabilité, HTML rendu identique (20 pages comparées octet par octet) |
| `quality/max-lines` sur les tests | avertissement | 3 → 3 | `tests/e2e/site.spec.ts`, `tests/unit/admin.test.ts`, `tests/unit/public.test.ts` ; découper au prochain ajout de tests |
| `quality/no-direct-console` | erreur | 0 | journal pino ; console permise dans les CLI et au démarrage de la fonction Netlify |
| `quality/no-direct-data-access` | erreur | 0 | vues et navigateur n'importent pas la base |
| `import-x/no-restricted-paths` (frontières) | erreur | 0 | vues ↛ `db/client.ts`, `db/seed.ts` ; `src/client` ↛ `src/server` (sondes de violation vérifiées) |
| `@typescript-eslint/no-floating-promises`, `no-misused-promises` | erreur (lint typé) | 1 → 0 | gestionnaire `submit` du formulaire de contact corrigé |
| `@typescript-eslint/no-unused-vars` | erreur | 1 → 0 | variable inutilisée dans `scripts/netlify-smoke.mjs` |
| `@typescript-eslint/no-non-null-assertion` | avertissement | 99 → 99 | plan ci-dessous |
| `complexity` (12), `max-statements` (20), `max-lines-per-function` (150), `max-params` (4), `max-depth`, `max-nested-callbacks` | avertissement | 33 → 32 | budget de discussion, pas une barrière |

Total actuel : 0 erreur, 134 avertissements (lint et lint typé).

### Plan de réduction

1. **Assertions non nulles (99)** : 37 dans les tests (acceptables, à garder en avertissement), 32 dans `src/client/`
   (`querySelector(...)!`), 23 dans les routes d'admin (`c.get('session')!` après `requireAdmin`), 7 dans
   `config.ts` et `lib/mail.ts`. Ordre proposé :
   une aide `currentSession(c)` typée dans `routes/admin/shared.tsx` (supprime les 23 d'un coup), puis des gardes
   explicites côté navigateur. Passer la règle en erreur pour `src/` quand `src/` atteint 0.
2. **Complexité** : les gros composants (`ProjectEditPage`, `WorkCard`, `Contact`) et les gestionnaires (connexion,
   envoi d'images, enregistrement d'un projet) ; découper seulement quand un changement fonctionnel les touche.
3. **Tests > 350 lignes** : découper par zone au prochain ajout (fichiers de tests par parcours).

## Stratégie de test

- Toute correction : reproduire, puis test de non-régression quand c'est faisable (Vitest pour le serveur, Playwright
  pour le navigateur).
- Vitest tourne sur PGlite en mémoire (aucun service). Les e2e et le paquet Netlify se lancent aussi sur PostgreSQL
  (`E2E_DATABASE_URL`, `NETLIFY_TEST_DATABASE_URL`), base dédiée et vidée — jamais une base de production.
- Refactorisation sans changement de comportement : comparer le HTML rendu avant / après (méthode utilisée pour le
  découpage du 18/10/2026 : instantanés de toutes les pages, y compris erreurs 404 et 422, jetons masqués).
- Accessibilité : axe (WCAG 2.2 AA) dans les e2e ; revue d'interface avec la compétence `web-design-guidelines`.

## Revue de sécurité

- Revue du dépôt : `docs/prompts/security-review.md` (lecture seule ; rapport privé hors du dépôt ; aucun envoi de code
  ou de secret à un service tiers).
- Diff sensible (auth, formulaires, envois de fichiers, configuration) : compétence `differential-review`.
- Schéma, requêtes, migrations : compétence `supabase-postgres-best-practices` (PostgreSQL générique, sans Supabase).
- Ne jamais déclarer le site « 100 % sûr » : une revue réduit le risque, elle ne le supprime pas.

## Dépendances

- Production : `npm audit --omit=dev` → 0 vulnérabilité (18/10/2026).
- Développement : 4 avertissements « moderate », une seule chaîne : `drizzle-kit` → `@esbuild-kit/*` → `esbuild ≤ 0.24.2`
  (serveur de développement d'esbuild, non utilisé ici). Le correctif proposé (`npm audit fix --force`) rétrograde
  `drizzle-kit` (changement cassant) : non appliqué ; à revoir à la prochaine version de `drizzle-kit`. La règle
  `overrides` de `package.json` pour cette chaîne est sans effet (esbuild 0.18 toujours installé sous `drizzle-kit`).
- Versions exactes dans `package.json` ; `npm ci` en CI.
