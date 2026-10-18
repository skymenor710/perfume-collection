# Tests

## Captures pleine page
- Fait : dans Chromium sans interface, un défilement rapide ne déclenche pas toujours l'IntersectionObserver ; les
  sections `[data-reveal]` restent à opacité 0 sur une capture pleine page. Pour des captures : `reducedMotion: 'reduce'`
  (contenu statique) ou le parcours lent `revealAll` de `tests/e2e/helpers.ts`. Le site réel n'est pas concerné
  (repli au défilement dans `src/client/motion.ts`).
- Source : audit du 18/10/2026 (`docs/AUDITORIA.md`, constat O8). Dernière vérification : 18/10/2026.
- Invalider si : les apparitions au défilement sont retirées ou réécrites.

## axe après les animations
- Fait : axe signale un contraste insuffisant sur un texte en cours de fondu (sections révélées, liens du menu mobile).
  Lancer l'analyse après `revealAll` et une fois les animations du menu terminées (opacité 1).
- Source : échecs puis corrections des tests du 18/10/2026. Dernière vérification : 18/10/2026.
- Invalider si : les animations d'apparition ou du menu changent.

## Latence des interactions
- Fait : le conteneur rend sans GPU ; un `backdrop-filter` plein écran rend chaque interaction de la visionneuse lente
  (120 ms à l'ouverture). Le flou invisible derrière un fond opaque à 97 % a été retiré (48 ms). Cible des tests : < 200 ms.
- Source : mesures Event Timing du 18/10/2026. Dernière vérification : 18/10/2026.
- Invalider si : nouveaux effets plein écran, ou mesures sur matériel avec GPU.
