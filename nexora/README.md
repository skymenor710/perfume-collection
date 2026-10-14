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

**Ajouter un vrai projet**
1. *Projets* → **Nouveau projet** (créé en brouillon, invisible).
2. Nom, catégorie (ex. « Site vitrine · Design sur mesure »), description facultative, adresse du site (https://…).
3. **Images** : choisir ou déposer jusqu’à 10 images (JPEG, PNG, WebP, AVIF ; 12 Mo max). Format carré conseillé
   (1600 × 1600). Elles sont vérifiées, nettoyées (GPS/EXIF supprimés) et converties en AVIF + WebP.
4. Renseigner le **texte alternatif** de chaque image (description pour les personnes malvoyantes et Google).
5. Ordre des images : flèches ↑ ↓ ; **Définir comme couverture** place l’image en premier.
6. Cocher **Publié**, choisir la **position 1, 2 ou 3** sur la page d’accueil, enregistrer.

**Remplacer les démonstrations** : les trois projets fournis (Altura, Maison Lenoir, Vélora) sont **fictifs** et
affichés avec la mention « Démonstration ». Une fois vos projets publiés et placés en positions 1–3, dépubliez ou
supprimez les démonstrations. Le sur-titre « Aperçus de démonstration » disparaît automatiquement dès qu’un vrai projet
est affiché. Le tableau de bord rappelle tant qu’une démonstration est publiée.

**Textes du site** : *Contenus du site* (bannière, boutons, réalisations, contact, pied de page, référencement,
informations légales). Seuls les textes sont modifiables : la mise en page ne peut pas être cassée (longueurs maximales,
pas de HTML).

**Demandes de contact** : *Demandes* — filtrer par statut (Nouvelle / En cours / Terminée), consulter, changer le
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
public/brand/        logo d’origine détouré, masques du néon, icônes ; public/fonts : Figtree (OFL)
assets-src/          fichiers ORIGINAUX fournis + scripts d’extraction (logo, masques, illustrations, démos)
drizzle/             migrations SQL versionnées
seed/demo/           visuels des projets de démonstration
tests/               unit/ (Vitest) et e2e/ (Playwright)
docs/                rapport de tests, captures d’écran, informations manquantes
```

Identité : noir `#09090C`, vin `#751B35`, vin de mise en avant `#982B49`, blanc chaud `#EAE6E8`. Pour le **texte** vin
sur fond noir, une teinte plus lumineuse (`#AD3158` grands titres, `#CF5277` petit texte) est utilisée afin de respecter
les contrastes WCAG AA ; les surfaces et boutons utilisent les couleurs d’origine.

Voir aussi : [docs/RAPPORT.md](docs/RAPPORT.md) (tests, sécurité, performance) et
[docs/A-COMPLETER.md](docs/A-COMPLETER.md) (informations et accès encore nécessaires).
