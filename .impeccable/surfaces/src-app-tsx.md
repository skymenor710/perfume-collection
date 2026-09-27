---
version: 1
slug: "src-app-tsx"
primary_target: "src/app.tsx"
related_targets: []
---

Scope: the whole app (single surface: the selection stage, with Wishlist and Minha coleção as two rosters, plus the Add sheet). Mode: Experience with Operate duties (add, mark as owned, verdict, filter).

Audience/job: the owner browsing their own perfumes on phone and desktop; picking the next buy, recording a verdict after wearing.

## Direction contract

THESIS: Character select for fragrances. One bottle stands alone on a pool of light in deep space; the rest of the roster recedes on a diagonal into darkness. Refuses the ecommerce grid, the product card, the dashboard sidebar.

OWN-WORLD: Near-black space (#040406 → #0b0b0f), silver hairlines at 8–14% white, Archivo variable (expanded ultralight uppercase nameplates, normal-width UI text). No cards, no rounded panels. The only color is the accent derived from the selected bottle (OKLCH, chroma clamped ≤0.14), living in star particles, a nebula breath behind the bottle, the light pool, the focus ring and the verdict mark.

STORY: Open → the first wish is already on stage and the galaxy wears its color. Drag/swipe/arrows scrub the roster; the color crossfades continuously with the scrub. Tap ↗ for the store. "Comprei" sends the bottle into the collection; there, a verdict is a stamp chosen from four Portuguese words; filters narrow the roster without leaving the stage.

FIRST VIEWPORT: Desktop: bottle centered, ~62vh tall, standing on a floor reflection and accent light pool; previous bottles recede up-left, next ones down-right, smaller and dimmer. Top: wordmark left, WISHLIST / COLEÇÃO toggle center, "+ Adicionar" right. Bottom-left: nameplate (NAME in expanded caps, brand · concentração · volume, price) with ↗ and the primary action (Comprei / veredito). Bottom-right: counter 03 / 14 and arrows. Mobile: same, stacked; bottle ~48vh; nameplate and action pinned above the safe area.

FORM: Brief-pinned world; the concept roll was skipped because the user's own words pin form and material: "Perfume Character Select" / "inspired by the character-selection screens of modern video games", and "The application should primarily use: deep black, charcoal, very dark gray, white, soft gray, subtle silver" with velixir.co.uk as inspiration. Seed key: none (pinned by brief; disclosed to the user).

Signature interaction: the roster is a continuous physical position; the atmosphere color is a function of that position, so dragging between two bottles literally blends their colors in OKLab. Inspect mode (tap the selected bottle): UI recedes, bottle scales, drag tilts it in perspective, pinch/wheel zooms slightly.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
