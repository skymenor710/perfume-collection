# Informations et accès encore nécessaires

Rien de ce qui suit n’a été inventé ni simulé. Le site fonctionne sans ces éléments (les demandes sont enregistrées et
visibles dans `/admin`), mais ils sont nécessaires avant l’ouverture au public.

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
| Nom de domaine + HTTPS | `PUBLIC_URL` | à fournir |
| Hébergement : Netlify (préparé : `netlify.toml`, README § 3 bis) **ou** hébergeur Node (processus permanent) | — | à choisir ; aucun compte relié, aucun déploiement fait |
| PostgreSQL de production (Neon / Netlify DB sur Netlify) | `DATABASE_URL` | à fournir — **obligatoire sur Netlify** |
| Stockage des images (S3/R2) ou volume persistant | `STORAGE_DRIVER`, `S3_*` | à fournir — **S3/R2 obligatoire sur Netlify** |
| Secret de session | `SESSION_SECRET` | à générer sur le serveur (commande dans `.env.example`) |
| Notification e-mail | `MAIL_PROVIDER` (`brevo` ou `resend`), `MAIL_API_KEY`, `MAIL_FROM` (expéditeur vérifié sur le domaine), `MAIL_TO` | **non configurée** : aucune clé disponible ; les envois n’ont pas pu être testés contre le vrai fournisseur (seulement contre un fournisseur simulé dans les tests) |
| Premier administrateur | `npm run admin:create -- --email …` | à créer sur le serveur |
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
