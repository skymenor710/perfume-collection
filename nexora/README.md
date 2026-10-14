# Nexora — site, administration et API

Site public de Nexora (création de sites web pour les entreprises), en français, avec son espace d’administration.
Projet **indépendant** du reste de ce dépôt : tout se passe dans le dossier `nexora/`.

| | |
|---|---|
| Site public | `/` (bannière, réalisations, contact), `/mentions-legales`, `/politique-de-confidentialite` |
| Administration | `/admin` (connexion obligatoire, aucune inscription publique) |
| Pile technique | Node 22 + TypeScript, Hono (HTML rendu côté serveur), Drizzle ORM, PostgreSQL, sharp, Vite (JS/CSS du navigateur) |
| Base de données | PostgreSQL (production) ou PGlite (PostgreSQL embarqué, développement / serveur unique) |
| Fichiers | disque persistant **ou** stockage compatible S3 (Cloudflare R2, Scaleway, OVH, AWS) |
| E-mail | notification des demandes via Brevo ou Resend (facultatif) |

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

**Ajouter une vraie étude de cas** (sans toucher au code)
1. *Projets* → **Nouveau projet** (créé en brouillon, invisible).
2. Nom, catégorie (ex. « Artisan · Site vitrine »), description facultative, adresse du site (https://… → bouton
   « Voir le projet »).
3. **Étude de cas** : *Contexte / défi*, *Solution apportée*, *Résultats mesurables* (uniquement des chiffres réels et
   vérifiables) et, si elle existe, l’adresse de l’étude complète (→ bouton « Lire l’étude de cas »).
4. **Images** : jusqu’à 10 captures (JPEG, PNG, WebP, AVIF ; 12 Mo max), format **16:10**, idéalement **2880 × 1800**
   (capture 1440 × 900 en densité 2) pour un texte net dans la visionneuse plein écran. Elles sont vérifiées, nettoyées
   (GPS/EXIF supprimés) et converties en AVIF + WebP de 480 à 2400 px. La première est la couverture.
5. Renseigner le **texte alternatif** de chaque image (lu par les lecteurs d’écran, repris en légende plein écran).
6. Décocher **Concept de démonstration**, cocher **Publié**, choisir la **position 1, 2 ou 3**, enregistrer.

**Projets fournis** : trois **concepts** conçus par Nexora avec Claude Code — une entreprise de maçonnerie et un
laboratoire in vitro (maquettes de prospection, noms et coordonnées floutés) et la page produit EARKO. Ils portent la
mention « Concept / Démonstration » et n’affichent aucun résultat chiffré (« aucun résultat mesuré à ce jour »). Dès
qu’un site est livré, ajoutez-le comme projet client (mention « Projet client ») et dépubliez les concepts. Le
tableau de bord rappelle tant qu’un concept est publié.

**Rendez-vous, WhatsApp, preuve sociale, témoignages** : *Contenus du site* → sections *Contact*, *Preuve sociale*,
*Témoignages*. La bande de chiffres et la section témoignages **n’apparaissent pas** pour les visiteurs tant qu’elles
sont vides (aucun contenu inventé) ; hors production, des emplacements « à compléter » montrent leur place
(`SHOW_PLACEHOLDERS`, voir `.env.example`). Le lien de rendez-vous (Cal.com, Calendly…, en `https://`) est utilisé par
tous les boutons « Réserver un diagnostic » ; vide, ils mènent au formulaire. Le numéro WhatsApp (format `+33 6 …`)
ajoute un bouton « Écrire sur WhatsApp ».

**Pages légales** : `/mentions-legales` et `/politique-de-confidentialite` existent et sont liées depuis le pied de page
et le formulaire ; leurs informations (raison sociale, SIRET, hébergeur…) se remplissent dans *Contenus du site →
Informations légales* (affichées « À compléter » tant qu’elles sont vides).

**Textes du site** : *Contenus du site* (bannière, boutons, réalisations, contact, pied de page, référencement,
informations légales). Seuls les textes sont modifiables : la mise en page ne peut pas être cassée (longueurs maximales,
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
| `npm test` | tests d’intégration (Vitest, PGlite en mémoire) |
| `npm run test:e2e` | tests navigateur (Playwright) sur le build ; `E2E_DATABASE_URL=postgres://…` pour PostgreSQL |
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
  routes/admin.tsx   administration
  views/             gabarits JSX (site + admin)
src/client/          JS du navigateur (menu, carrousels, mouvement, formulaire, admin)
src/styles/          CSS du site et de l’admin
public/brand/        logo reconstruit (symbole AVIF/WebP 96→1600 px, masque vectoriel du néon, logotype SVG), icônes
brand/               logo 4K livrable (PNG transparents, version UHD sur fond noir, SVG) — voir § 7
public/fonts/        Figtree (OFL)
assets-src/          fichiers ORIGINAUX fournis + scripts (logo 4K, illustrations, captures des démos)
drizzle/             migrations SQL versionnées
seed/demo/           captures des 3 projets du portfolio (assets-src/portfolio/)
tests/               unit/ (Vitest) et e2e/ (Playwright)
docs/                rapport de tests, captures d’écran, informations manquantes
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
