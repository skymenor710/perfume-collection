# Rapport de tests — site Nexora

Date : 14 octobre 2026. Tous les résultats ci-dessous ont été **réellement exécutés** dans l’environnement de
développement (conteneur Linux, Node 22.22, Chromium 141, PostgreSQL 16.15 local). Rien n’a été publié en production.

## 1. Synthèse

| Contrôle | Résultat |
|---|---|
| TypeScript strict (`npm run typecheck`) | ✅ 0 erreur |
| Tests d’intégration (`npm test`, Vitest, PGlite en mémoire) | ✅ 51 / 51 |
| Tests navigateur (`npm run test:e2e`, Playwright, build de production) | ✅ 13 / 13 sur **PostgreSQL 16.15** |
| Audit des dépendances (`npm audit`) | ✅ 0 vulnérabilité (après passage de sharp 0.35.4 → 0.35.5, CVE librsvg) |
| Revue de sécurité du code (revue dédiée + sondages manuels) | ✅ aucune vulnérabilité exploitable identifiée ; 1 durcissement appliqué |
| Lighthouse 12.8.2, mobile | Performance **100** · Accessibilité **100** · Bonnes pratiques **100** · SEO **100** |
| Lighthouse 12.8.2, ordinateur | Performance **100** · Accessibilité **100** · Bonnes pratiques **100** · SEO **100** |
| Sauvegarde → restauration (PGlite + disque → PostgreSQL + autre disque) | ✅ 3 projets, 9 images, 81 fichiers vérifiés (SHA-256), image servie après restauration (mesuré avec les anciennes démonstrations) |

## 2. Performance (laboratoire)

Mesures **de laboratoire** (Lighthouse, conditions simulées), pas des mesures d’utilisateurs réels. L’INP de terrain
(Core Web Vitals des visiteurs) n’existe pas encore : il faudra des données réelles (CrUX / Search Console) après la mise
en ligne. Le TBT ci-dessous est un indicateur de laboratoire, pas l’INP.

Conditions : build de production, `NODE_ENV=production`, serveur local, 3 projets de démonstration.

| Profil | LCP | CLS | TBT | FCP | Speed Index |
|---|---|---|---|---|---|
| Mobile (Moto G Power émulé, 4G lente : RTT 150 ms, 1,6 Mb/s, CPU ×4) | 1,4 s | 0 | 20 ms | — | — |
| Ordinateur (RTT 40 ms, 10 Mb/s) | 0,4 s | 0 | 0 ms | — | — |

(Mesures refaites après la version « premium » : logo 4K, visionneuse, finitions. Les mesures précédentes étaient
LCP 1,8–1,9 s mobile et 0,5 s ordinateur.)

Objectifs demandés : Performance ≥ 90, Accessibilité ≥ 95, Bonnes pratiques ≥ 95, SEO ≥ 95, LCP ≤ 2,5 s, CLS ≤ 0,1 —
**tous atteints** dans ces conditions. Limite : serveur local (temps de réponse quasi nul) ; en production, la latence
réelle de l’hébergeur et de la base s’ajoute. Rapports complets : `reports/lighthouse/mobile.html`, `desktop.html`.

Ce qui a été fait pour y arriver :
- HTML rendu côté serveur, mis en cache par version de contenu ; JS client 9 Ko (3,3 Ko gzip), aucune bibliothèque.
- CSS du site intégré dans la page (supprime une requête bloquante), autorisé par empreinte SHA-256 dans la CSP.
- Compression gzip des réponses texte ; cache navigateur d’un an pour les fichiers statiques et les images.
- Police Figtree auto-hébergée (sous-ensemble latin, `font-display: swap`, préchargée, police de repli ajustée).
- Images : AVIF + WebP en 480/640/800/1200/1600 px, `srcset`/`sizes`, dimensions explicites (CLS 0).
- Carrousels : seule la 1re image de chaque carte est chargée ; les suivantes uniquement quand le visiteur utilise CE
  carrousel (vérifié par test : 3 images au chargement, et un clic dans un carrousel ne charge rien dans les autres).
- Animations en `transform` / `opacity` ; néon et animations mis en pause hors écran.

### Corrections faites à la suite des mesures
1. 1re mesure : Accessibilité 94 (rôles ARIA de la liste des diapositives, nom accessible du logo du pied de page) →
   corrigé → 100.
2. Images surdimensionnées (symbole, logotype) → nouvelles tailles 320/640 px et `sizes` exacts.
3. Cache de 30 jours sur la marque et les polices → 1 an.
4. Feuille de style bloquante → intégrée (gain estimé 130 ms sur mobile).
5. Le test E2E a révélé que Chrome préchargeait toutes les images des carrousels → chargement différé piloté par carrousel.

## 3. Tests fonctionnels et visuels (Playwright, navigateur réel)

| Scénario | Vérifié |
|---|---|
| Largeurs 375, 390, 768, 1440, 1920 px | aucun débordement horizontal, aucune erreur console ni requête en échec, cartes strictement carrées, pas de chevauchement texte / bouton / symbole sur mobile |
| Navigation | liens internes : la section s’arrête sous l’en-tête fixe (84 px / 68 px) ; en-tête flouté au défilement |
| Menu mobile | ouverture, focus piégé, Échap, retour du focus, fermeture au clic + navigation |
| Carrousels | flèches, points, boucle, clavier (←, →, Début, Fin), **glissement tactile réel** (événements touch) ; les deux autres carrousels ne bougent jamais |
| Néon | animation `neon-sweep` 8,5 s (passage + pause), découpée par le tracé vectoriel de la bande vin, en pause hors écran |
| Visionneuse | clic sur une capture → plein écran, titre, compteur, légende = texte alternatif, variante ≥ 1200 px ; ←/→ et boutons en boucle ; zoom au clic et dézoom ; Échap ; focus rendu au carrousel, qui affiche l’image vue en dernier ; bouton « Agrandir » au clavier ; **glisser au doigt** sur mobile |
| Texte non éditable | clic dans un titre : aucun point d’insertion (`caret-color` transparent), curseur flèche, aucun focus ; les champs du formulaire gardent curseur et point d’insertion ; liens = main |
| Parallaxe | transformation appliquée au défilement, défilement natif intact |
| Mouvement réduit | néon figé, aucune parallaxe, tout le contenu visible |
| Formulaire | ouverture accessible, erreurs par champ, **échec serveur simulé : données conservées**, succès affiché seulement après HTTP 201 |
| Persistance | demande visible dans l’admin |
| Administration | redirection sans connexion, mauvais mot de passe, connexion, changement de statut, création de projet, envoi de 2 images, textes alternatifs, couverture, reflet immédiat sur le site (position 2, lien, alt, sans mention démo), suppression d’image (contrôles du carrousel masqués avec une seule image), modification des textes, déconnexion |
| Redémarrage | serveur arrêté puis relancé : projets, images, textes et demandes toujours présents |

Captures (build de production) : `docs/screenshots/` — `home-{1920,1440,768,390,375}-{viewport,full}.webp` et
administration `a-*.webp`. Comparaison visuelle avec les maquettes faite côte à côte (proportions du hero, taille des
titres, cartes, section contact) et corrigée en deux passes (tailles de titres et de boutons, découpe du titre, espacements).

Écarts assumés par rapport aux maquettes :
- Cartes **carrées** (exigence), alors que la maquette les montre légèrement plus hautes que larges.
- Le titre mobile de la section est « Des projets concrets. Des résultats visibles. » (texte demandé), pas « Nos réalisations. ».
- Menu « Accueil / Réalisations / Contact » (demandé) au lieu de « Expertises » de la maquette.
- Le hero de la maquette est un rendu 3D ; le site utilise le logo **reconstruit en 4K depuis les fichiers fournis**
  (géométrie du symbole HD, rendu du bandeau — voir README § 7), mis en lumière par des calques (halo, reflet, néon). Le texte vin sur noir est éclairci (`#AD3158`,
  `#CF5277`) pour respecter le contraste WCAG AA ; les fonds et boutons gardent `#751B35` / `#982B49`.
- L’illustration de la section contact (montagne, chemin, porte) est dessinée en SVG (pas de photo générée).
- Mobile : un seul bouton dans le hero, comme sur la maquette ; « Découvrir nos réalisations » reste accessible par
  l’indicateur de défilement et le menu.

## 4. Sécurité

Portée : code du projet et serveur **local** uniquement. Aucun test contre un site tiers.

Mesures en place (toutes couvertes par des tests automatisés) :
- **Authentification** côté serveur sur toutes les routes `/admin` (sauf la page de connexion) ; aucune inscription.
  Mots de passe scrypt (N=2¹⁵), 12 caractères minimum, comparaison à temps constant, hachage factice si le compte
  n’existe pas (pas d’énumération).
- **Sessions** côté serveur : jeton aléatoire 256 bits, seule son empreinte SHA-256 est stockée ; cookie `HttpOnly`,
  `SameSite=Lax`, `__Host-` + `Secure` en https ; expiration 12 h (2 h d’inactivité) ; nouvelle session à chaque connexion
  ; déconnexion = suppression en base ; changement de mot de passe = fermeture des autres sessions.
- **CSRF** : jeton par session sur toutes les actions + contrôle d’origine (`Origin`, `Sec-Fetch-Site`) ; connexion
  protégée par double soumission (`SameSite=Strict`).
- **Limitation de débit** en base (multi-instances) : connexion 20/15 min par IP et verrouillage du compte après
  8 échecs ; formulaire 5/15 min par IP ; IP et e-mails jamais stockés en clair (HMAC).
- **Anti-spam** : pot de miel, jeton horodaté signé (envoi < 2,5 s refusé), plus de 3 liens refusés. Pas de CAPTCHA tiers.
- **Validation serveur** (Zod) de toutes les entrées, longueurs maximales, requêtes SQL paramétrées (Drizzle).
- **XSS** : rendu JSX échappé, aucun HTML accepté dans les contenus, URL de projet limitée à http/https (refus de
  `javascript:`, `data:`, identifiants dans l’URL), CSP stricte (`script-src 'self'`, aucun script inline).
- **Fichiers envoyés** : type déterminé par le contenu (pas l’extension), décodage complet par sharp, SVG/GIF refusés,
  12 Mo et 50 Mpx max, 10 fichiers par envoi, ré-encodage AVIF/WebP sans métadonnées, noms de fichiers générés par le
  serveur, clés de stockage validées (pas de traversée de répertoire).
- **Accès aux fichiers** : images d’un projet non publié invisibles sans session admin ; le maître haute définition
  n’est jamais servi.
- **En-têtes** : CSP, HSTS (https), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP,
  `noindex` + `no-store` sur l’admin.
- **Erreurs** : message neutre pour le visiteur, détail seulement dans le journal ; journal sans mot de passe, jeton,
  cookie, e-mail ni téléphone (masquage testé).
- **Secrets** : uniquement dans les variables d’environnement ; `SESSION_SECRET` obligatoire en production ;
  `.env.example` sans aucune valeur secrète ; aucun compte par défaut.

Sondages manuels sur le serveur de production local : traversées (`/assets/..%2f..%2f.env`, `/fonts/%2e%2e/…`,
`/media/../../.env`, fichiers source, manifeste) → 404 ; méthodes TRACE/PUT → 404 ; JSON invalide → 400 ; corps de
1 Mo → 413 ; actions admin sans session → 401 ; page admin sans session → 303 vers la connexion.

Revue de code de sécurité dédiée : **aucune vulnérabilité exploitable** identifiée. Un point de durcissement relevé et
corrigé : l’enregistrement des contenus acceptait des clés héritées (`__proto__.toString`) — désormais filtré par
`Object.hasOwn` (test ajouté). Exploitable seulement par un administrateur connecté (risque : arrêt du processus).

Limites (aucun site n’est « 100 % sûr ») : pas de double authentification (2FA) ; pas de CAPTCHA ; la limitation de
débit dépend de `TRUST_PROXY` correctement réglé derrière le proxy de l’hébergeur ; les images publiées restent dans le
cache des navigateurs/CDN après dépublication ; pas de test d’intrusion externe ni d’analyse de l’infrastructure de
production (inexistante à ce jour) ; dépendances à auditer régulièrement (`npm audit`, Dependabot).

## 5. Accessibilité

Lighthouse 100 (mobile et ordinateur). En plus : lien d’évitement, focus visible thémé, navigation complète au clavier
(menu avec focus piégé, carrousels au clavier, annonce « Image 2 sur 3 » en zone `aria-live`), libellés de formulaire,
erreurs reliées aux champs (`aria-describedby`, `aria-invalid`), cibles tactiles ≥ 24 px, contraste AA, `prefers-reduced-motion`.
Un audit Lighthouse ne remplace pas un test avec un lecteur d’écran réel (VoiceOver / NVDA), recommandé avant lancement.

## 6. Comment rejouer

```bash
cd nexora
npm ci && npm run typecheck && npm test && npm run build
npm run test:e2e                                   # PGlite
E2E_DATABASE_URL=postgres://… npm run test:e2e     # PostgreSQL (base dédiée : elle est vidée)
node scripts/screenshots.mjs http://localhost:3000/ docs/screenshots 1920,1440,768,390,375
npx lighthouse http://localhost:3000/ --preset=desktop   # et sans --preset pour le mobile
```

La CI GitHub (`.github/workflows/nexora.yml`) exécute audit, typecheck, tests, build et tests navigateur sur
PostgreSQL 16 à chaque modification du dossier `nexora/`.
