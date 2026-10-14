---
name: Nexora
description: Studio web premium — noir profond, lumière vin, géométrie du symbole N.
colors:
  black: "#09090C"
  wine: "#751B35"
  wine-2: "#982B49"
  wine-text: "#AD3158"     # texte vin sur noir, grands titres (contraste 3,2:1)
  wine-text-sm: "#CF5277"  # texte vin sur noir, petit texte (4,8:1)
  white: "#EAE6E8"
typography:
  family: "Figtree (variable, auto-hébergée)"
  display: "clamp(2.375rem, 1.3rem + 4.25vw, 5.2rem) / 1.08, poids 450, -0.022em"
  section: "clamp(2.125rem, 1.4rem + 3.17vw, 4.4rem) / 1.02, poids 450"
  body: "1rem / 1.55"
---

# Nexora — système visuel

- **Ambiance** : fond noir quasi absolu, halos vin diffus, lignes fines (`rgb(234 230 232 / .1)`), aucun gris neutre
  pour le texte secondaire (blanc chaud à 82 % / 62 %).
- **Symbole N** : reconstruit en 4K depuis les fichiers fournis (`brand/`, chaîne `assets-src/logo4k/`), rendu du
  bandeau (bande vin lumineuse, panneaux « verre »). Site : `public/brand/symbol-*.{avif,webp}` (96→1600 px) ; reflet
  néon découpé par le tracé vectoriel de la bande (`symbol-wine.svg`) ; logotype `wordmark.svg`.
- **Lumières** : halos et traînées toujours diffus (flou), jamais de trait net ; les lueurs du hero s'éteignent avant
  son bord. Filets fins uniquement là où la maquette en a (en-tête, bandeau contact).
- **Visionneuse** : captures des projets en plein écran (`<dialog>`), fond flouté, zoom ×2 au point cliqué, glisser.
- **Lecture seule** : flèche et aucun point d'insertion hors des champs ; main sur liens et boutons.
- **Mouvement** : un seul moment signature (le néon, 8,5 s, passage puis pause) ; parallaxe ≤ 90 px ; apparitions
  `cubic-bezier(.16,1,.3,1)` ; tout est statique avec `prefers-reduced-motion`.
- **Boutons** : 66 px (hero), rayon 14 px ; primaire = dégradé vin, secondaire = contour vin, contact = blanc chaud.
- **Cartes projets** : carrées, rayon 10 px, flèches rondes à 66 % de la hauteur, points blancs en bas, badge
  « Démonstration » pour les exemples. Commandes (flèches, « Agrandir ») révélées au survol à la souris, toujours visibles au toucher.
- **Admin** : même palette, sobre et dense (mode « opérer »).
