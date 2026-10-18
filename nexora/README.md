# Nexora — site, administration et API

Site public de Nexora (création de sites web pour les entreprises), en français, avec son espace d’administration.
Projet **indépendant** du reste de ce dépôt : tout se passe dans le dossier `nexora/`.

| | |
|---|---|
| Site public | `/` (hero, réalisations, services, processus, FAQ, contact), `/mentions-legales`, `/politique-de-confidentialite` |
| Administration | `/admin` (connexion obligatoire, aucune inscription publique) |
| Pile technique | Node 22 + TypeScript, Hono (HTML rendu côté serveur), Drizzle ORM, PostgreSQL, sharp, Vite (JS/CSS du navigateur) |
| Base de données | PostgreSQL (production) ou PGlite (PostgreSQL embarqué, développement / serveur unique) |
| Fichiers | disque persistant **ou** stockage compatible S3 (Cloudflare R2, Scaleway, OVH, AWS) |
| E-mail | notification des demandes via Brevo ou Resend (facultatif) |

**Documentation** : produit et périmètre → [`PRODUCT.md`](PRODUCT.md) · code et décisions →
[`docs/architecture.md`](docs/architecture.md) · interface et accessibilité → [`DESIGN.md`](DESIGN.md) · commandes et
contrôles → [`docs/quality.md`](docs/quality.md) · instructions des agents → [`AGENTS.md`](AGENTS.md) ·
outillage et preuves → [`docs/setup.md`](docs/setup.md) · informations manquantes →
[`docs/A-COMPLETER.md`](docs/A-COMPLETER.md) · tests → [`docs/RAPPORT.md`](docs/RAPPORT.md).

---

## 1. Lancer le projet en local

Prérequis : Node.js 22.13 ou plus récent.

```bash
cd nexora
npm ci                      # dépendances (versions figées par package-lock.json)
cp .env.example .env        # puis renseigner SESSION_SECRET (commande dans le fichier)
npm run build               # construit le JS/CSS du navigateur (dist/client)
npm run db:seed             # crée la base + 3 projets de DÉMONSTRATION
npm run admin:create -- --email vous@exemple.fr   # crée le premier administrateur (mot de passe demandé, masqué)
npm start                   # http://localhost:3000  — administration : http://localhost:3000/admin
```

`npm run dev` reconstruit le navigateur puis relance le serveur à chaque modification du code serveur.

### Premier administrateur

Aucun compte n’existe par défaut et aucun mot de passe n’est écrit dans le code. Le compte se crée **sur le serveur** :

```bash
npm run admin:create -- --email vous@exemple.fr            # 12 caractères minimum
npm run admin:create -- --email vous@exemple.fr --reset    # mot de passe oublié : réinitialise et ferme les sessions
```

Sans terminal interactif (conteneur, CI) : `printf '%s\n' "$MOT_DE_PASSE" | npm run admin:create -- --email …`.

---

## 2. Gérer le contenu (sans toucher au code)

Tout se fait dans `/admin`. Chaque modification est publiée immédiatement : le serveur incrémente une « version de
contenu » en base, et toutes les instances re-génèrent la page à la requête suivante.

**Ajouter un projet à « Nos réalisations »** (sans toucher au code)
1. *Projets* → **Nouveau projet** (créé en brouillon, invisible).
2. **Nom**, **catégorie** (ex. « Artisan · Site vitrine »), **description courte** (une phrase : c'est le résumé affiché
   sur la carte), **adresse du site** (→ bouton « Voir le site » ; uniquement une adresse réelle et publique).
3. *Étude de cas* (dans le détail repliable de la carte) : *Contexte / défi*, *Solution apportée*.
4. Type de projet :
   - **Projet client** (case *Concept de démonstration* décochée) : **résultats vérifiables** (chiffres réels, avec l’accord
     du client — affichés sous le résumé), **témoignage** (citation exacte + nom · fonction, accord écrit) et, si elle
     existe, l’adresse de l’étude complète (→ « Lire l’étude de cas ») ;
   - **Concept** (case cochée) : *Objectif de conversion et principes* — jamais de résultat chiffré.
5. **Images** : captures 16:10, idéalement **2880 × 1800** (1440 × 900 à densité 2), avec leur **texte alternatif**
   (ce que montre la capture). La première est la couverture ; l’ordre se change avec les flèches. Chaque image devient
   une diapositive de la galerie de la carte (flèches, points, clavier, glisser au doigt) et s’ouvre en plein écran.
6. **Mise en avant** (position 1 à 3) pour choisir l’ordre sur l’accueil, cocher **Publié**, enregistrer.

Ordre dans « Nos réalisations » : les projets clients d’abord (3 au plus), puis les concepts (3 au plus), chacun avec son
badge (« Projet client » / « Concept / Démonstration »). Le sous-titre de la section explique la différence ; il reste
vrai dans les deux cas.

**Projets fournis** : trois **concepts** conçus par Nexora avec Claude Code — une entreprise de maçonnerie et un
laboratoire in vitro (maquettes de prospection, noms et coordonnées floutés) et la page produit EARKO, signalés
« Concept / Démonstration ». Aucun n’a d’adresse publique renseignée (voir `docs/A-COMPLETER.md`).

**Appels à l’action** : « Demander un devis » (en-tête, hero, services) mène **toujours** au formulaire ; « Voir nos
réalisations » au portfolio. La prise de rendez-vous n’est proposée que dans la section Contact, quand un lien est
configuré : aucun bouton ne dit « Réserver » sans réservation réelle.

**Rendez-vous, WhatsApp, preuve sociale, témoignages, équipe** : *Contenus du site*. Règle du code : ces sections
n’existent sur la page que lorsqu’elles contiennent des données réelles — aucun texte d’exemple ou d’administration
n’est jamais montré aux visiteurs.
- **Lien de rendez-vous** (`https://`) : renseigné → bloc « Réserver un créneau de 20 min » dans la section Contact.
  Cal.com et Calendly s’ouvrent dans une fenêtre intégrée (la confirmation de réservation déclenche l’événement
  `booking_completed`) ; tout autre service dans un nouvel onglet. Vide → pas de bloc.
- **WhatsApp** (`+33 6 …`) : bouton « Écrire sur WhatsApp » près du formulaire.
- **Derrière Nexora** : nom + texte (+ photo envoyée en bas de la page *Contenus du site*).
- **Public visé et zone** : ligne de positionnement sous l’accroche du hero.
- **Référencement local** (*Contenus du site → Référencement*) : titre, description et **zones desservies**
  (Romorantin-Lanthenay, Blois, Orléans, Centre-Val de Loire par défaut) — reprises dans les données structurées
  schema.org (`ProfessionalService.areaServed`) et le pied de page. Pas de pages « par ville » artificielles ; l’adresse,
  le téléphone et l’e-mail n’apparaissent dans les données structurées que s’ils sont réellement saisis.

**Mesure d’audience et événements de conversion** : les événements `cta_primary`, `cta_secondary`, `cta_header`,
`service_click` (avec le service), `form_start`, `form_submit_success`, `booking_open`, `booking_completed`,
`whatsapp_click` sont émis dans la page (`window` → `nexora:track`) sans rien envoyer. Pour les transmettre à Plausible :
`ANALYTICS_PROVIDER=plausible` et `ANALYTICS_DOMAIN=…` ; un bandeau demande alors le consentement, aucun script n’est
chargé avant « Accepter », le choix est modifiable en pied de page et la politique de confidentialité s’adapte.

**Pages légales** : `/mentions-legales` et `/politique-de-confidentialite` existent et sont liées depuis le pied de page
et le formulaire ; leurs informations (raison sociale, SIRET, hébergeur…) se remplissent dans *Contenus du site →
Informations légales* (affichées « À compléter » tant qu’elles sont vides).

**Textes du site** : *Contenus du site* (bannière, boutons, réalisations, 5 services, 4 étapes du processus, FAQ,
contact, pied de page, référencement, informations légales). L’affichage applique la typographie française (espaces
insécables avant « ? ! ; : » et dans « »). Seuls les textes sont modifiables : la mise en page ne peut pas être cassée (longueurs maximales,
pas de HTML).

**Demandes de contact** : *Demandes* (avec budget estimatif et délai souhaité s’ils sont indiqués) — filtrer par statut (Nouvelle / En cours / Terminée), consulter, changer le
statut, supprimer (ex. demande d’effacement RGPD).

---

## 3. Publier (mise en production)

Rien n’a été déployé ni souscrit. Recommandation simple et peu coûteuse :

* **Application** : n’importe quel hébergeur Node avec un processus permanent (Render, Railway, Fly.io, Scalingo,
  Clever Cloud, ou un VPS). Commande de build : `npm ci && npm run build` ; commande de démarrage : `npm start`.
* **Base** : PostgreSQL managé (Neon, Supabase, Scaleway, OVH…) → `DATABASE_URL=postgres://…?sslmode=require`.
* **Images** : bucket S3/R2 → `STORAGE_DRIVER=s3` + `S3_*` (le disque des plateformes serverless ou des conteneurs
  éphémères est perdu au redémarrage ; `STORAGE_DRIVER=local` n’est valable qu’avec un volume persistant).

Variables indispensables en production (voir `.env.example`) :

```
NODE_ENV=production
PUBLIC_URL=https://www.votre-domaine.fr      # https → cookies Secure (__Host-), HSTS, upgrade-insecure-requests
SESSION_SECRET=…48 caractères aléatoires…
DATABASE_URL=postgres://…
MIGRATE_ON_START=true                        # ou `npm run db:migrate` avant chaque déploiement
STORAGE_DRIVER=s3 + S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
TRUST_PROXY=true                             # seulement derrière le proxy de l’hébergeur (IP réelle pour la limitation)
```

Puis, une fois : `npm run admin:create -- --email …` sur le serveur (ou en local avec la `DATABASE_URL` de production).
Facultatif : `npm run db:seed` pour les démonstrations.

Avant l’ouverture au public : compléter les **informations légales** dans l’admin (le tableau de bord liste ce qui
manque) et configurer l’e-mail.

### 3 bis. Netlify (préparé, non déployé)

Le site peut aussi tourner sur **Netlify** : la même application Hono s’exécute dans une fonction (`netlify/functions/site.mts`,
toutes les routes) et les fichiers statiques de `dist/client` sont servis par le CDN. Configuration : `netlify.toml`.

| Élément | Sur Netlify |
| --- | --- |
| Pages, formulaire, admin | fonction `site` (Netlify Functions v2, `path: /*`, fichiers statiques prioritaires) |
| JS, CSS, marque, polices | CDN (`publish = dist/client`, en-têtes de cache dans `netlify.toml`) |
| Base de données | **PostgreSQL obligatoire** (Neon ou « Netlify DB », qui utilise Neon) — PGlite refusé |
| Images | **S3 obligatoire** (Cloudflare R2, Scaleway…) — le disque d’une fonction est éphémère |
| IP du visiteur | fournie par la plateforme (`context.ip`) ; `TRUST_PROXY` doit rester désactivé |
| Ménage (sessions, compteurs) | fonction planifiée `netlify/functions/menage.mts` (`@hourly`) |
| Migrations | pendant le build (`npm run build && npm run db:migrate`), refusées si la base n’est pas PostgreSQL |

Étapes (à faire par vous, avec votre compte — rien n’a été publié ni souscrit) :
1. Créer une base PostgreSQL (Neon) et un bucket R2 (ou S3) avec une clé d’accès limitée à ce bucket.
2. Netlify → *Add new site* → importer le dépôt, **Base directory** : `nexora` (le reste vient de `netlify.toml`).
3. *Site configuration → Environment variables* (portées **Builds** et **Functions**) : `NODE_ENV=production`,
   `PUBLIC_URL=https://…` (adresse définitive), `SESSION_SECRET` (48 caractères aléatoires), `DATABASE_URL`,
   `STORAGE_DRIVER=s3` + `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, `UPLOAD_MAX_MB=4`,
   et si besoin `MAIL_*`, `ANALYTICS_*`.
4. Déployer, puis créer l’administrateur depuis votre poste avec la base de production :
   `DATABASE_URL=… SESSION_SECRET=… STORAGE_DRIVER=s3 S3_…=… npm run admin:create -- --email vous@exemple.fr`.

Limites connues de Netlify : requête de 6 Mo au plus (envoyer les images **une par une**, `UPLOAD_MAX_MB=4`) et 10 s
d’exécution par défaut (26 s sur les offres payantes) — une très grande image peut dépasser ce délai lors de la
génération des variantes AVIF ; en cas d’échec, réduire la capture à 2880 px de large.

Vérification locale du paquet de fonctions (empaqueté comme sur Netlify, base PostgreSQL de test) :
`NETLIFY_TEST_DATABASE_URL=postgres://… npm run test:netlify` — 17 contrôles (configuration refusée, pages, en-têtes,
formulaire enregistré, limitation par IP de la plateforme, X-Forwarded-For falsifié ignoré, fonction planifiée).
Ce test ne remplace pas un premier déploiement réel, qui n’a pas été fait.

---

## 4. Sauvegarde et restauration

```bash
npm run backup                         # → backups/nexora-AAAA-MM-JJ-HHMMSS/ (database.json + files/ + files.json)
npm run backup -- --out /chemin/sûr
npm run restore -- backups/nexora-…    # dans une base vide (migrations appliquées automatiquement)
npm run restore -- backups/nexora-… --force   # vide d’abord la base cible
```

* La sauvegarde contient **toutes** les tables utiles (comptes, projets, images, contenus, demandes, journal) et
  **tous** les fichiers d’images, avec leur empreinte SHA-256 vérifiée à la restauration.
* Fonctionne quel que soit le couple base/stockage (PostgreSQL ou PGlite, disque ou S3) : utile aussi pour migrer.
* Le dossier contient des données personnelles et des empreintes de mots de passe : le stocker **chiffré**, hors du
  serveur (ex. archive chiffrée sur un stockage distinct). Conseil : une sauvegarde quotidienne (tâche planifiée de
  l’hébergeur) + conservation 30 jours.
* En complément, avec PostgreSQL : `pg_dump "$DATABASE_URL" -Fc -f nexora.dump` / `pg_restore -d "$DATABASE_URL" nexora.dump`,
  et pour R2/S3 : `rclone sync r2:nexora-media ./media-backup`.
* Tester la restauration au moins une fois (sur une base de test) : une sauvegarde jamais restaurée n’est pas une sauvegarde.

---

## 5. Commandes

| Commande | Rôle |
|---|---|
| `npm run build` | JS/CSS du navigateur (Vite) |
| `npm start` / `npm run dev` | serveur |
| `npm run db:migrate` | applique les migrations SQL versionnées (`drizzle/`) |
| `npm run db:generate` | génère une nouvelle migration après modification de `src/server/db/schema.ts` |
| `npm run db:seed` | projets de démonstration (si aucun projet) |
| `npm run admin:create` | crée / réinitialise un administrateur |
| `npm run backup` / `npm run restore` | sauvegarde / restauration |
| `npm run typecheck` | vérification TypeScript |
| `npm run lint` / `npm run lint:typed` / `npm run lint:rules` | ESLint rapide, ESLint avec types (promesses), auto-test des règles locales — voir `docs/quality.md` |
| `npm run check` | tout le contrôle local : types, lint, tests, build (ne publie rien, ne migre rien) |
| `npm test` | tests d’intégration (Vitest, PGlite en mémoire) |
| `npm run test:e2e` | tests navigateur (Playwright) sur le build : projets `desktop` et `mobile` (Pixel 7 émulé), accessibilité axe (WCAG 2.2 AA), latence des interactions ; `E2E_DATABASE_URL=postgres://…` pour PostgreSQL |
| `npm run test:netlify` | paquet des fonctions Netlify, empaqueté et exercé localement (`NETLIFY_TEST_DATABASE_URL=postgres://…`) |
| `node scripts/screenshots.mjs [url] [dossier] [largeurs]` | captures d’écran + contrôle du débordement |
| `npm run brand:logo` | régénère le logo 4K et tous ses dérivés (voir § 7) — Python 3 + `opencv-python-headless`, `potracer` |

---

## 6. Organisation du code

```
src/server/
  app.tsx            assemblage : en-têtes de sécurité, compression, statiques, routes, erreurs
  config.ts          variables d’environnement validées (Zod)
  db/                schéma Drizzle, connexion, données de démonstration
  lib/               auth (sessions, CSRF), sécurité (CSP…), stockage, images, e-mail, contenus, limitation de débit
  routes/public.tsx  pages publiques, formulaire de contact, images (/media), robots, sitemap
  routes/admin.tsx   administration : session, CSRF, connexion ; routes/admin/ — une zone par module
  views/             gabarits JSX : site/ (accueil découpé par section), admin/ (une zone par module)
  main.ts            serveur Node (processus permanent)
  serverless.ts      même application en fonction serverless (Netlify)
netlify/functions/   site.mts (toutes les routes) et menage.mts (fonction planifiée) — voir § 3 bis
src/client/          JS du navigateur : menu, galeries des réalisations (gallery.ts), visionneuse (lightbox.ts),
                     mouvement (motion.ts), formulaire, réservation, consentement, événements
src/styles/          CSS du site et de l’admin
public/brand/        logo reconstruit (symbole AVIF/WebP 96→1600 px, masque vectoriel du néon, logotype SVG), icônes
brand/               logo 4K livrable (PNG transparents, version UHD sur fond noir, SVG) — voir § 7
public/fonts/        Figtree (OFL)
assets-src/          fichiers ORIGINAUX fournis + scripts (logo 4K, illustrations, captures des démos)
drizzle/             migrations SQL versionnées
seed/demo/           captures des 3 projets du portfolio (assets-src/portfolio/)
tests/               unit/ (Vitest) et e2e/ (Playwright)
docs/                audit (AUDITORIA.md), livraison (ENTREGA.md), rapport de tests, captures, informations manquantes
```

Identité : noir `#09090C`, vin `#751B35`, vin de mise en avant `#982B49`, blanc chaud `#EAE6E8`. Pour le **texte** vin
sur fond noir, une teinte plus lumineuse (`#AD3158` grands titres, `#CF5277` petit texte) est utilisée afin de respecter
les contrastes WCAG AA ; les surfaces et boutons utilisent les couleurs d’origine.

---

## 7. Logo 4K

Le logo du site est **reconstruit en haute définition** à partir des fichiers fournis (aucun redessin à main levée) :

* **Géométrie** : tracée sur le fichier symbole d’origine (1254 px). Il n’a pas d’anticrénelage (bords en escalier
  d’1 px et liseré de pixels parasites rouges/bleus) : ces pixels sont écartés, les portions droites sont remplacées par
  leur droite des moindres carrés, les angles vifs par l’intersection exacte de leurs deux droites, les courbes sont
  lissées, puis le tout est vectorisé en courbes de Bézier (potrace). Bords nets à toute taille, sans escalier ni liseré.
* **Rendu** : celui du **symbole du bandeau** (bande vin plus lumineuse, panneaux « verre » avec un liseré doux) : le
  bandeau est recalé sur le fichier HD (même dessin, IoU 0,94) et son éclairage est transféré (gain basse fréquence).
* **Logotype NEXORA** : redessiné en **géométrie exacte** d’après des mesures prises sur le bandeau (fûts et barres
  rectangulaires, diagonales et ellipses du O ajustées par moindres carrés — `assets-src/logo4k/wordmark.py`), sur une
  grille où la capitale fait 19 unités et la graisse 3 (rapport du bandeau). Sur le site il s’affiche à 133 × 22 px,
  soit 1 unité = 1 pixel (2 sur écran Retina) et à une position arrondie au pixel : bords nets, sans liseré flou.

| Fichier (`brand/`) | Contenu |
|---|---|
| `nexora-symbole-4k.png` | symbole, 3695 × 3840, fond transparent |
| `nexora-logo-4k.png` | symbole + logotype (disposition du bandeau), 3840 px de large, fond transparent |
| `nexora-logo-4k-fond-noir.png` | même verrouillage en 3840 × 2160 (UHD) sur fond `#09090C` |
| `nexora-logotype.svg`, `nexora-logotype-noir.svg`, `nexora-symbole-silhouette.svg` | vectoriels (blanc chaud / noir / silhouette) |

Sur le site : symbole en AVIF + WebP de 96 à 1600 px (choisis selon l’écran), logotype en SVG, reflet néon découpé par
le tracé vectoriel de la bande vin, icônes et image de partage régénérées depuis le 4K.
Chaîne : `assets-src/logo4k/` (`trace.py` → `wordmark.py` → `rasterize.mjs` → `compose.py` → `export.mjs`), lancée par `npm run brand:logo`.

Voir aussi : [docs/RAPPORT.md](docs/RAPPORT.md) (tests, sécurité, performance) et
[docs/A-COMPLETER.md](docs/A-COMPLETER.md) (informations et accès encore nécessaires).
