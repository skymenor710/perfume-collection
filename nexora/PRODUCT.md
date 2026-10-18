# Product

<!-- Les cinq premières sections suivent le format lu par le plugin impeccable (design) ; les suivantes, le modèle de
     produit du Vibe Coding Toolkit. Ce fichier est la référence du périmètre. -->

## Platform
web

## Users
Dirigeants et responsables de PME et indépendants en France — en priorité Romorantin-Lanthenay, Blois, Orléans et le
Centre-Val de Loire (zone à confirmer) — qui cherchent un prestataire pour créer ou refaire leur site.

## Product Purpose
Site de Nexora (création de sites web premium pour PME). Succès : le visiteur comprend l'offre en quelques secondes,
voit des réalisations crédibles et envoie une demande de devis enregistrée.

## Brand Commitments
Maquettes fournies par le client (assets-src/mockup-*.png) = référence. Noir #09090C, vin #751B35, vin de mise en
avant #982B49, blanc chaud #EAE6E8. Logo et bandeau originaux, jamais redessinés (reconstruits en 4K à partir des
fichiers fournis). Néon uniquement sur la bande vin du N. Textes publics en français.

## Evidence on Hand
Aucun client réel à ce jour : les 3 projets publiés sont des concepts conçus par Nexora (maçonnerie, laboratoire in
vitro, EARKO), signalés « Concept / Démonstration ». Aucune donnée légale (SIRET, adresse), aucun avis, chiffre ou
témoignage réel fourni : ne rien inventer (`docs/A-COMPLETER.md`).

## Problème et objectif
Une PME qui veut un site sérieux ne sait pas à qui confier le projet ni ce qu'elle obtiendra. Le site doit montrer le
travail, expliquer l'offre et le processus, et transformer la visite en demande de devis qualifiée.

## Public et rôles
- Visiteur (prospect) : consulte, envoie une demande, réserve un créneau si un lien d'agenda est configuré.
- Administrateur Nexora : se connecte à `/admin`, publie projets et textes, traite les demandes.

## Parcours de la première version
| Entrée | Action | Résultat attendu |
| --- | --- | --- |
| Accueil | lire la promesse, « Voir nos réalisations » | galerie des réalisations, statut de chaque projet visible |
| Service ou « Demander un devis » | remplir le formulaire | demande enregistrée en base, confirmation seulement après l'enregistrement, notification e-mail si configurée |
| `/admin` | se connecter, créer un projet, envoyer des images | projet visible sur l'accueil, sans toucher au code |
| `/admin/demandes` | consulter, changer le statut, supprimer | suivi des demandes, effacement RGPD possible |

## MVP
Accueil (hero, réalisations, services, processus, FAQ, contact), pages légales, administration (projets, images,
contenus, demandes, compte), formulaire anti-spam, sauvegarde/restauration, déploiement préparé (Node ou Netlify).

## Hors périmètre
Blog, multilingue, paiement en ligne, espace client, CRM, pages artificielles « par ville », faux avis ou chiffres.

## Exigences
- Données : demandes de contact conservées pour la durée fixée dans les informations légales ; aucune revente.
- Accessibilité : WCAG 2.2 AA (contrôlé par axe dans les tests), navigation clavier complète, mouvement réduit respecté.
- Langue : français, typographie française ; appareils : téléphone, tablette, ordinateur.
- Sécurité : CSP stricte, sessions serveur, CSRF, limitation de débit, aucun secret dans le navigateur.

## Contraintes et décisions techniques
Pile réelle et décisions : `docs/architecture.md`. La base PostgreSQL/Drizzle est conservée (pas de migration de pile).

## Hypothèses et décisions en attente
- Zone d'intervention et mode d'échange (visio / téléphone / e-mail) : écrits d'après la demande de SEO local, à
  confirmer (réversible dans l'admin).
- Adresses publiques des concepts, chiffres visibles dans les captures du concept maçonnerie : décision du propriétaire.
- Hébergeur (Netlify préparé, rien déployé), base et stockage de production : à fournir.

## Critères d'acceptation
- Produit : un visiteur envoie une demande depuis un téléphone et la voit apparaître dans l'admin ; un projet créé
  dans l'admin apparaît sur l'accueil ; aucune information inventée n'est affichée.
- Technique (séparé) : `npm run check` vert, tests navigateur verts, Lighthouse ≥ 90/95/95/95 (`docs/quality.md`).

## Prochaine livraison
Mise en ligne : compléter `docs/A-COMPLETER.md` (légal, base, stockage, domaine), déployer, créer l'administrateur.

## Maintenance
Mettre à jour ce fichier quand le périmètre, le public ou une décision produit change.
