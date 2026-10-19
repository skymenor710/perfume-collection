# Code et architecture

Ce document décrit uniquement ce qui existe dans `nexora/` (vérifié le 18/10/2026, commit de base `3c62e0f`). Les
projets futurs sont signalés comme tels.

## Pile réelle

| Élément | Choix et version observée |
| --- | --- |
| Exécution | Node.js ≥ 22.13 (testé en 22.22), modules ES, TypeScript 5.9 strict exécuté par `tsx` |
| Serveur HTTP | Hono 4.13 + `@hono/node-server` 2.1 (processus permanent, `src/server/main.ts`) ou fonction Netlify (`src/server/serverless.ts`) |
| Rendu | JSX de Hono rendu côté serveur (échappement automatique), aucune bibliothèque d'interface côté client |
| Navigateur | TypeScript sans framework, construit par Vite 8 (`dist/client`) ; CSS du site intégré dans la page, autorisé par son empreinte CSP |
| Données | Drizzle ORM 0.45 ; PostgreSQL (`pg` 8) en production, PGlite 0.5 (PostgreSQL embarqué) en développement et dans les tests |
| Validation | Zod 4 (configuration, formulaires, contenus) |
| Journal | pino 10 (JSON, masquage des champs sensibles : `src/server/log.ts`) |
| Images | sharp 0.35 (AVIF + WebP, plusieurs largeurs) ; stockage disque local ou compatible S3 (`aws4fetch`) |
| Tests | Vitest 5 (intégration, PGlite en mémoire) ; Playwright 1.63 + axe-core (navigateur réel, projets `desktop` et `mobile`) |
| Paquets | npm, `package-lock.json` (versions exactes) |

## Carte du code

```
src/server/
  main.ts            serveur Node permanent (+ ménage horaire)
  serverless.ts      même application pour Netlify (instance réutilisée, refus des réglages non persistants)
  bootstrap.ts       assemble les dépendances : config, base, stockage, e-mail, fichiers du navigateur
  app.tsx            en-têtes de sécurité, compression, IP du client, fichiers statiques, routes, erreurs
  config.ts          variables d'environnement validées (Zod) ; seule source des secrets
  context.ts         types partagés (Deps, AppEnv)
  db/                schéma Drizzle, connexion (pg / PGlite), données de démonstration
  lib/               auth (sessions, CSRF), sécurité (CSP, IP), contact (jeton, anti-spam), contenus,
                     images, stockage, e-mail, limitation de débit, dépôt (requêtes)
  routes/            public.tsx (pages, /contact, /media, robots, sitemap) ; admin.tsx (session, connexion,
                     contrôles communs à toute l'admin, puis enregistrement des zones dans un ordre fixe) ;
                     admin/ (une zone par module : tableau de bord, projets, images, contenus, demandes, compte ;
                     shared.tsx = aides communes)
  views/             gabarits JSX : layout.tsx ; site/ (accueil découpé par section : hero, works, sections,
                     contact, overlays ; pages légales, erreurs) ; admin/ (une zone par module, pages.tsx = point
                     d'entrée qui ré-exporte)
src/client/          JS du navigateur : menu, galeries, visionneuse, mouvement, formulaire, réservation,
                     consentement, événements
src/styles/          site.css, admin.css
netlify/functions/   site.mts (toutes les routes), menage.mts (fonction planifiée)
scripts/             CLI : migrations, données de démo, administrateur, sauvegarde/restauration, captures,
                     aperçu autonome, essai du paquet Netlify
drizzle/             migrations SQL versionnées (+ instantanés drizzle-kit)
tests/               unit/ (Vitest), e2e/ (Playwright)
assets-src/          fichiers d'origine et scripts de production du logo 4K et des captures
```

## Frontières et flux

1. Requête → `app.tsx` : en-têtes de sécurité, compression, IP du client (plateforme > proxy de confiance > connexion).
2. `routes/` : contrôle d'origine (CSRF), limitation de débit, validation Zod, session pour `/admin`. Hono applique
   middlewares et routes dans l'ordre d'enregistrement : dans `routes/admin.tsx`, session, CSRF et taille maximale du
   corps sont enregistrés avant les zones `routes/admin/*` — toute nouvelle route d'admin passe par un `register…`
   appelé après eux.
3. `lib/` et `lib/repo.ts` : règles et requêtes Drizzle paramétrées.
4. `views/` : gabarits purs, reçoivent des données déjà préparées (contenu avec typographie française, projets).
   Les gabarits n'importent ni la base ni la configuration secrète.
5. Navigateur : `src/client/` n'importe jamais de code serveur ; il échange avec le serveur par formulaire ou `fetch`.

Secrets : uniquement dans les variables d'environnement lues par `config.ts` ; jamais envoyés au navigateur
(la seule valeur publique est `PUBLIC_URL`).

Limitation de la connexion admin (`routes/admin.tsx`) : 20 essais / 15 min par IP ; 8 échecs / 15 min par compte pour
un appareil inconnu, mais un appareil où l'administrateur s'est déjà connecté (cookie `__Host-nx_dev`, 180 jours) n'est
limité que par ses propres échecs (couple e-mail + IP) — un tiers qui connaît l'e-mail ne peut donc pas bloquer
l'administrateur. Jeton du formulaire de contact : 2,5 s minimum, 48 h maximum. Journal : erreurs SQL sans leurs
paramètres (`errorSummary`, `src/server/log.ts`).

## Données et migrations

- Schéma : `src/server/db/schema.ts` (projets, images, demandes de contact, administrateurs, sessions, limitation de
  débit, réglages du site, version de contenu, journal d'audit). Types inférés par Drizzle.
- Connexion : `src/server/db/client.ts` — `pg` (pool borné à 8, `keepAlive` ; `sslmode=require`, `prefer` ou
  `verify-ca` relevé en `verify-full` ; sans `sslmode`, un hôte distant est joint en `verify-full`, un hôte local ou
  sans domaine reste en clair ; `sslmode=disable` explicite respecté) ou PGlite (dossier ou mémoire). Les erreurs des
  connexions inactives sont journalisées. Un seul point d'entrée, ouvert au démarrage par `bootstrap.ts`.
- Migrations : `npm run db:generate` (drizzle-kit, après revue du SQL produit), `npm run db:migrate` (ou
  `MIGRATE_ON_START=true` sur un serveur Node). Sur Netlify : pendant le build du contexte `production` uniquement
  (aperçus et branches : ignorées), refusées si la base n'est pas PostgreSQL ou si `SESSION_SECRET` manque.
  Aucune migration pendant une requête.
- Cache : HTML de l'accueil mis en cache par « version de contenu » (une ligne en base, incrémentée à chaque
  modification de l'admin), donc cohérent entre plusieurs instances.
- **PGlite : un seul processus par dossier.** Deux serveurs ouverts sur le même `data/db` corrompent la base locale.
- Notifications : `src/server/lib/notify.ts` — e-mail envoyé APRÈS l'enregistrement de la demande ; échec noté sur la
  demande et renvoyé par la tâche horaire (24 h au plus). Sauvegarde : instantané en lecture seule (`repeatable read`),
  fichiers `0600`.
- Version déployée : `/version.txt` (commit écrit pendant le build Netlify par `scripts/build-info.mjs`).

## Décisions

| Décision | Raison | Alternative écartée | Source / date | À revoir si |
| --- | --- | --- | --- | --- |
| Hono + JSX serveur, sans framework client | page légère (JS 18 Ko), Lighthouse 100, CSP stricte sans inline | Next.js / React | construction initiale, 10/2026 | besoin d'interactions riches côté client |
| PostgreSQL + Drizzle, PGlite en local | une seule famille SQL partout ; tests sans service externe | SQLite, ORM plus lourd | 10/2026 | hébergement imposant une autre base |
| Base nécessaire (pas de site statique) | demande enregistrée avant confirmation, admin, sessions, limitation de débit | formulaire tiers | 10/2026 | abandon de l'admin |
| Fonction Netlify qui réutilise l'application | aucune double implémentation | réécriture en fonctions séparées | `docs/AUDITORIA.md`, 18/10/2026 | autre hébergeur choisi |
| Pas de Framer Motion / Motion | pas de React ; IntersectionObserver + CSS suffisent (0 Ko) | bibliothèque `motion` | 18/10/2026 | animations complexes demandées |
| Contenus éditables en texte simple (Zod, longueurs max) | la mise en page ne peut pas casser ; jamais de HTML stocké | éditeur riche | 10/2026 | — |

## Maintenance

Mettre à jour ce document dans le même changement que toute modification de structure, de frontière, de schéma ou de
flux de données. Les commandes et contrôles sont dans `docs/quality.md` ; la préparation locale dans `README.md` § 1.
