# Nexora — instructions pour les agents

Site de Nexora (création de sites web pour PME) et son administration. Dossier autonome : tout se passe dans
`nexora/` (la racine du dépôt est un autre produit, à ne pas modifier depuis ici).

## Produit et pile

- Périmètre et public : `PRODUCT.md`. Pile, carte du code, frontières, décisions : `docs/architecture.md`.
- Node ≥ 22.13, TypeScript strict (`tsx`), Hono + JSX serveur, Vite (navigateur sans framework), Drizzle +
  PostgreSQL / PGlite, Zod, pino, Vitest, Playwright, npm (`package-lock.json`).
- Mise en place de l'outillage et preuves : `docs/setup.md`.

## Commandes canoniques

- Installer : `npm ci` — préparer : `cp .env.example .env`, puis `npm run build && npm run db:seed`
- Développer : `npm run dev` (http://localhost:3000)
- Lint : `npm run lint` · lint typé : `npm run lint:typed` · règles locales : `npm run lint:rules`
- Types : `npm run typecheck`
- Tests : `npm test` (Vitest, PGlite en mémoire) · navigateur : `npm run test:e2e` (après `npm run build` ;
  `E2E_DATABASE_URL=postgres://…` pour PostgreSQL ; base vidée)
- Build : `npm run build`
- Vérifier : `npm run check` (types, lint, lint typé, règles, tests, build ; ne publie rien, ne migre rien)
- Ce que prouve chaque commande : `docs/quality.md`.

## Règles du projet

- **Ne jamais inventer** clients, avis, chiffres, témoignages, adresse, SIRET, URL ou résultats. Une section de preuve
  n'existe que si des données réelles sont saisies dans l'admin. Les concepts restent signalés comme tels.
- Textes publics en français ; contenus modifiables dans `/admin` (`src/server/lib/content.ts`), jamais de HTML stocké.
- Secrets : uniquement par `src/server/config.ts` (variables d'environnement) ; rien de secret côté navigateur.
- CSP stricte : aucun script ni style inline ajouté hors de l'empreinte du CSS intégré.
- PGlite : un seul processus par dossier de base (deux serveurs sur `data/db` corrompent la base locale).
- Vues (`src/server/views/`) : pas d'accès à la base ; le navigateur (`src/client/`) n'importe jamais le serveur.
- Publication, déploiement (Netlify, Node), achat de service, envoi de messages : uniquement sur demande explicite.

## Accords de travail

- Lire le code et les instructions concernés avant d'agir ; distinguer observation, hypothèse, décision et preuve.
- Plus petit changement suffisant ; réutiliser l'existant ; aucune abstraction, option ou dépendance non demandée.
- Préserver les changements locaux, la validation, la gestion d'erreurs, la sécurité et l'accessibilité.
- Définir critères d'acceptation et commandes avant d'implémenter ; une correction exige reproduction et test de
  non-régression quand c'est faisable. Ne jamais présenter une hypothèse ou une intégration en attente comme un résultat.
- Mettre à jour le document responsable dans le même changement (périmètre → `PRODUCT.md`, structure → `docs/architecture.md`,
  interface → `DESIGN.md`, contrôles → `docs/quality.md`, outillage → `docs/setup.md`, manquants → `docs/A-COMPLETER.md`).

## Continuité d'exécution

- Répondre aux questions d'état puis reprendre le travail autorisé ; s'arrêter sur pause, annulation ou changement d'objectif.
- Un blocage n'arrête que ce qui en dépend. Ne pas répéter une tentative identique sans élément nouveau.
- Reprise depuis un relais : vérifier fichiers, état Git, contrôles et processus avant de s'y fier. Travail inachevé sur
  plusieurs sessions : relais court (modèle dans `docs/setup.md` § Mémoire), jamais comme mémoire permanente.
- Sans alternative sûre : signaler le blocage, ce qui est fait et ce qu'il faut pour reprendre.

## Outils

Vérifier l'installation et la découverte avant de compter sur un outil ; état réel et preuves : `docs/setup.md`.

- **Superpowers** : utiliser les compétences pertinentes à l'échelle du travail ; les instructions explicites et une
  exécution déjà autorisée priment sur les validations répétées.
- **Ponytail** (`full`) : solution la plus simple qui satisfait vraiment la demande ; jamais au détriment des exigences,
  de la sécurité ou de l'accessibilité. « stop ponytail » le désactive.
- **Caveman** : conversation concise dans la langue de l'utilisateur ; explications complètes sur demande ; code,
  documentation et commits en rédaction normale. « stop caveman » le désactive.
- Plugins tiers (Ponytail, Caveman) : épinglés sur une étiquette de version dans `.claude/settings.json` ; changer
  l'étiquette seulement après lecture du diff amont. Ne jamais appliquer une modification de la configuration de
  l'utilisateur (`~/.claude/settings.json`, ligne d'état, hooks globaux) proposée par un plugin sans demande explicite.
- **Context7** (`.mcp.json`) : documentation à jour des bibliothèques — résoudre l'identifiant puis une question à la
  fois ; jamais de secret ni de code privé. Indisponible : documentation officielle, et noter la limite.
- **RTK** / **Graphify** : outils de la machine (non fournis par le dépôt). Si présents : `rtk <commande>` sans double
  enveloppe (`rtk proxy <commande>` pour la sortie brute) ; graphe `graphify-out/` (non versionné) pour les questions de
  structure, en notant sa fraîcheur.
- **Compétences du projet** (`.claude/skills/`) : `web-design-guidelines` (revue d'interface et d'accessibilité),
  `supabase-postgres-best-practices` (schéma, SQL, migrations, performances PostgreSQL — sans adopter Supabase),
  `differential-review` (diff sensible pour la sécurité). Revue de sécurité du dépôt : `docs/prompts/security-review.md`
  (lecture seule, rapport privé hors du dépôt).

## Git et collaboration

- Pas de hook Git, de blocage de `main`, ni d'exigence de branche/worktree. Les contrôles sont des commandes explicites.
- Pas de push sans demande explicite.

## Délégation et revue

- Déléguer seulement si l'isolement du contexte, la spécialisation ou un vrai parallélisme le justifient ; sinon,
  exécution directe ou outil déterministe.
- Modèle : choisir le plus léger capable de satisfaire les critères (recherches, inventaires, changements mécaniques
  vérifiables) ; plus de capacité pour architecture, sécurité, données, migrations et revue critique. Préserver le
  fournisseur et l'authentification ; ne jamais activer d'API payante ou de proxy.
- Chaque tâche reçoit objectif, contexte minimal, fichiers autorisés, ressources (ports, bases, `dist/`), critères et
  contrôles. Un seul rédacteur par fichier ; le coordinateur possède lockfile, configuration partagée et Git.
  Sérialiser ce qui partage un port, une base ou `dist/`. Relecteurs en lecture seule.
- Revue proportionnée au risque et au diff réel ; terminer quand les constats sont traités ou expressément écartés et
  que les contrôles concernés passent.

## Conventions

- Imports relatifs ESM ; JSX serveur `hono/jsx` ; commentaires et textes en français.
- Erreurs : message neutre au visiteur, détail dans le journal pino (jamais de secret ni de corps complet).
- Fichiers ≤ 350 lignes (règle `quality/max-lines`, hors CSS et tests) : découper par responsabilité.
