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

## Contenus de conversion — données RÉELLES uniquement

Rien n’a été inventé : les sections ci-dessous restent **masquées pour les visiteurs** tant qu’elles sont vides. Hors
production (`SHOW_PLACEHOLDERS=auto`), des emplacements hachurés « à compléter » montrent où elles s’afficheront. Le
tableau de bord de l’admin rappelle ce qui manque (« Contenus de conversion à compléter »).

| À fournir | Où le saisir | Remarque |
|---|---|---|
| [ ] Lien de prise de rendez-vous (Cal.com, Calendly, Google Agenda…) | Admin › Contenus › Section Contact › *Lien de prise de rendez-vous* | `https://` obligatoire. Tant qu’il est vide, « Réserver un diagnostic » mène au formulaire. |
| [ ] Numéro WhatsApp (facultatif) | Admin › Contenus › Section Contact › *Numéro WhatsApp* | Format international : `+33 6 12 34 56 78`. Ajoute un bouton « Écrire sur WhatsApp » (lien wa.me). |
| [ ] 2 à 4 chiffres de preuve sociale | Admin › Contenus › Preuve sociale | Uniquement vérifiables : note et nombre d’avis Google, nombre de sites livrés, résultat mesuré… |
| [ ] Témoignages clients (1 à 3) | Admin › Contenus › Témoignages | Citation exacte, nom et fonction réels, **accord écrit** du client. |
| [ ] Études de cas réelles | Admin › Projets › (projet) › Étude de cas | Contexte / défi, solution, **résultats mesurés** (chiffres réels), lien vers l’étude complète. Décocher « Concept de démonstration ». |
| [ ] Validation des réponses de la FAQ | Admin › Contenus › Questions fréquentes | Elles engagent l’entreprise (délais, budget, propriété du site, maintenance) : à relire et ajuster. |
| [ ] Engagement « Réponse sous 1 jour ouvré » | Admin › Contenus › Bannière et Contact | À conserver seulement s’il est tenu en pratique. |
| [ ] Tranches de budget du formulaire | `src/server/lib/content.ts` (`BUDGETS`, `TIMELINES`) | Valeurs indicatives proposées ; à adapter aux prix réels. |

## Autres contenus

- [ ] Vrais projets (nom, catégorie, lien, images 16:10 — idéalement 2880 × 1800 —, textes alternatifs) pour remplacer les 3 concepts affichés (maçonnerie, laboratoire, EARKO), signalés « Concept / Démonstration ».
- [ ] Validation des textes (promesse, services, méthode) — proposés et modifiables dans l’admin.
