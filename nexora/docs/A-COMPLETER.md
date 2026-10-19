# Informations et accès encore nécessaires

Rien de ce qui suit n’a été inventé ni simulé. Le site fonctionne sans ces éléments (les demandes sont enregistrées et
visibles dans `/admin`), mais ils sont nécessaires avant l’ouverture au public.

## En production (constaté le 19/10/2026 sur https://nexora-creation.fr)

- [ ] **Mentions légales et politique de confidentialité affichent « À compléter »** pour tous les champs ci-dessous :
  obligation légale, à saisir dans l’admin avant toute prospection. Hébergeur (vérifié sur les conditions de Netlify) :
  `Netlify, Inc.` — `101 2nd Street, San Francisco, CA 94105, États-Unis`.
- [ ] **Section « Nos réalisations » vide** (« Nos premières réalisations seront bientôt présentées ici ») : publier
  les projets dans `/admin → Projets` (ou lancer `npm run db:seed` avec les variables de production pour les 3
  concepts du portfolio).
- [ ] **Supprimer les deux demandes « Test technique (audit Nexora…) »** (`/admin → Demandes`), envoyées le 19/10/2026
  pour vérifier le formulaire, et vérifier leurs notifications dans la boîte `nexora.services1@hotmail.com` (dossier
  courrier indésirable compris) ; dans l'admin, chaque demande indique « Envoyée le … » ou l'erreur du fournisseur.
- [ ] DNS OVHcloud (facultatif) : supprimer l’ancien enregistrement TXT `1|www.nexora-creation.fr` (reste d’une
  redirection OVH, sans effet) ; après quelques semaines de rapports DMARC sans anomalie, passer `_dmarc` de `p=none` à
  `p=quarantine` ; un enregistrement CAA `0 issue "letsencrypt.org"` limite l’émission de certificats.

## Informations légales (à saisir dans /admin → Contenus du site → Informations légales)

Obligatoires (mentions légales, LCEN art. 6 ; politique de confidentialité, RGPD) — affichées « À compléter » tant
qu’elles sont vides, et listées sur le tableau de bord :

- [ ] Raison sociale
- [ ] Forme juridique (SAS, SARL, EI…) et capital social si société
- [ ] Adresse du siège
- [ ] SIRET (et RCS + ville, si immatriculée au RCS)
- [ ] N° de TVA intracommunautaire (si assujettie)
- [ ] Directeur de la publication
- [ ] E-mail de contact pour les demandes RGPD
- [ ] Hébergeur : nom, adresse, téléphone (dépend de l’hébergeur choisi)
- [ ] Durée de conservation des demandes de contact (décision de l’entreprise ; souvent 3 ans après le dernier contact)

Facultatif : e-mail et téléphone à afficher publiquement dans la section contact.

## Accès / services (variables d’environnement, voir `.env.example`)

| Besoin | Variable(s) | État |
|---|---|---|
| Nom de domaine + HTTPS | `PUBLIC_URL` | **en service** : `https://nexora-creation.fr` (domaine principal ; `www` et l’adresse `netlify.app` redirigent), certificat Let’s Encrypt |
| Hébergement | — | **Netlify, en production** (`netlify.toml`, README § 3 bis) |
| PostgreSQL de production (Neon) | `DATABASE_URL` | **en service** (le formulaire enregistre ; vérifié le 19/10/2026) |
| Stockage des images (Cloudflare R2) | `STORAGE_DRIVER=s3`, `S3_*` | **configuré** (la fonction refuse de démarrer sans) ; aucune image publiée pour l’instant |
| Secret de session | `SESSION_SECRET` | obligatoire : le build Netlify échoue sans lui (contrôle ajouté le 19/10/2026) |
| Notification e-mail | `MAIL_PROVIDER=brevo`, `MAIL_FROM=Nexora <site@nexora-creation.fr>`, `MAIL_TO=nexora.services1@hotmail.com`, `MAIL_API_KEY` | domaine authentifié chez Brevo (DNS : code de vérification, DKIM `brevo1`/`brevo2`, DMARC — vérifiés le 19/10/2026). Réception à confirmer dans la boîte de destination (demande de test du 19/10/2026) ; une notification en échec est renvoyée toutes les heures pendant 24 h |
| Premier administrateur | `npm run admin:create -- --email …` | page de connexion en service ; compte non vérifiable depuis l’extérieur |
| Sauvegardes planifiées | tâche cron de l’hébergeur + stockage chiffré | à mettre en place |

## Contenus de conversion — données RÉELLES uniquement

Rien n’a été inventé. Règle appliquée dans le code : une section de preuve n’existe sur la page que lorsque des données
réelles sont saisies ; sinon elle est **absente** (aucun texte d’exemple, d’instruction ou « à compléter » n’est jamais
montré aux visiteurs). Le tableau de bord de l’admin liste ce qui manque (« Contenus de conversion à compléter »).

| À fournir | Où le saisir | Effet sur le site |
|---|---|---|
| [ ] Lien de prise de rendez-vous (facultatif, Cal.com ou Calendly de préférence) | Admin › Contenus › Section Contact › *Lien de prise de rendez-vous* | Bloc « Réserver un créneau de 20 min » dans la section Contact (fenêtre intégrée Cal.com / Calendly, sinon nouvel onglet). Les boutons « Demander un devis » mènent toujours au formulaire. |
| [ ] Numéro WhatsApp (facultatif) | Admin › Contenus › Section Contact › *Numéro WhatsApp* (`+33 6 …`) | Bouton « Écrire sur WhatsApp » près du formulaire. |
| [ ] Chiffres de preuve sociale (1 à 4) | Admin › Contenus › Preuve sociale (valeur + légende) | Bande « En quelques chiffres » sous le hero. Uniquement des chiffres vérifiables. |
| [ ] Témoignages (1 à 3) | Admin › Contenus › Témoignages (citation, nom, fonction · entreprise) | Section « Ils nous ont confié leur site ». Citation exacte, **accord écrit** du client. |
| [ ] Section « Derrière Nexora » | Admin › Contenus › Derrière Nexora (nom, fonction, texte) + photo (même page, en bas) | Section après la méthode. Personne et photo réelles. |
| [ ] **Zone d’intervention à confirmer** (Romorantin-Lanthenay, Blois, Orléans, Centre-Val de Loire) | Admin › Contenus › Bannière › *Public visé et zone* ; Référencement › *Zones desservies* ; FAQ question 7 | Reprise dans le hero, la FAQ, le pied de page et les données structurées. Aucune adresse n’est publiée : l’adresse réelle se saisit dans les informations légales. Les rendez-vous sont annoncés « en visioconférence, par téléphone ou par e-mail » : à corriger si vous recevez aussi sur place. |
| [ ] Projets clients | Admin › Projets › (projet) › décocher *Concept de démonstration* ; remplir *Résultats vérifiables*, *Témoignage*, *Lien* | En tête de « Nos réalisations », badge « Projet client », résultats sous le résumé, témoignage dans le détail. |
| [ ] **Adresses publiques des démonstrations** (facultatif) | Admin › Projets › (concept) › *Adresse du site* | Bouton « Voir le site ». Deux de vos artifacts correspondent (« EARKO SecureFit Ear Clips », « AWM Biotech ») mais ils sont privés par défaut et le nom AWM a été volontairement flouté dans les captures : à décider (partage public + confidentialité) avant de les relier. Aucune adresse n’a été inventée. |
| [ ] **Chiffres visibles dans les captures du concept maçonnerie** | `seed/demo/maconnerie-*.webp` | Les captures du site-concept affichent « QUALIBAT · RT 2020 », « 4,6 / 5 · 20 avis Google », « Depuis 2016 ». S’ils ne sont pas les vraies données de l’entreprise prospectée, refaire ces captures avec ces chiffres floutés. |
| [ ] Validation des réponses de la FAQ | Admin › Contenus › Questions fréquentes | Elles engagent l’entreprise (délais, budget, propriété, maintenance). |
| [ ] Engagement « Réponse sous 1 jour ouvré » | Admin › Contenus › Bannière et Contact | À conserver seulement s’il est tenu. |
| [ ] Tranches de budget du formulaire | `src/server/lib/content.ts` (`BUDGETS`, `TIMELINES`) | Valeurs indicatives proposées. |
| [ ] Mesure d’audience (facultatif) | Variables `ANALYTICS_PROVIDER=plausible`, `ANALYTICS_DOMAIN` | Bandeau de consentement ; rien n’est chargé avant « Accepter ». La politique de confidentialité s’adapte automatiquement. |

## Autres contenus

- [ ] Vrais projets clients (images 16:10 — idéalement 2880 × 1800 —, textes alternatifs) ; les 3 concepts (maçonnerie, laboratoire, EARKO) restent dans « Nos réalisations », badge « Concept / Démonstration », tant qu’ils sont publiés.
- [ ] Validation des textes (promesse « Création de sites web premium pour les PME », 5 services, 4 étapes, FAQ) — proposés et modifiables dans l’admin. En particulier « Devis gratuit » et « Réponse sous 1 jour ouvré » : à conserver seulement s’ils sont tenus.
