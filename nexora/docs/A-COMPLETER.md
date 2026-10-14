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
| Hébergement Node (processus permanent) | — | à choisir (aucun service souscrit) |
| PostgreSQL de production | `DATABASE_URL` | à fournir |
| Stockage des images (S3/R2) ou volume persistant | `STORAGE_DRIVER`, `S3_*` | à fournir |
| Secret de session | `SESSION_SECRET` | à générer sur le serveur (commande dans `.env.example`) |
| Notification e-mail | `MAIL_PROVIDER` (`brevo` ou `resend`), `MAIL_API_KEY`, `MAIL_FROM` (expéditeur vérifié sur le domaine), `MAIL_TO` | **non configurée** : aucune clé disponible ; les envois n’ont pas pu être testés contre le vrai fournisseur (seulement contre un fournisseur simulé dans les tests) |
| Premier administrateur | `npm run admin:create -- --email …` | à créer sur le serveur |
| Sauvegardes planifiées | tâche cron de l’hébergeur + stockage chiffré | à mettre en place |

## Contenus

- [ ] Vrais projets (nom, catégorie, lien, 1 à 10 images carrées, textes alternatifs) pour remplacer les 3 sites de référence (Snøhetta, Opinel, Wavestone), qui ne sont pas des réalisations de Nexora.
- [ ] Validation des textes (titre, accroche, messages) — ceux des maquettes sont en place et modifiables.
- [ ] Logo vectoriel (SVG/AI) si disponible : le site utilise le PNG original détouré (net jusqu’à 960 px).
