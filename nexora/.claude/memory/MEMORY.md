# Mémoire du projet — index

Court par principe (≤ 40 lignes). Chaque ligne renvoie à une entrée détaillée, à lire seulement quand le sujet se
présente. Avant de s'appuyer sur une entrée : vérifier `last_verified` et `invalidate_when` ; corriger ou retirer ce qui
est dépassé. Ne rien enregistrer qui se déduit du code ou figure déjà dans la documentation (`AGENTS.md`, `docs/`).

## Environnement (sessions claude.ai/code)
- [Conteneur éphémère](environnement.md#conteneur-éphémère) — seul le dépôt persiste ; outils globaux à réinstaller.
- [Proxy GitHub](environnement.md#proxy-github) — API et pages de releases GitHub refusées (403), `git clone` accepté.
- [Context7 à approuver](environnement.md#context7-à-approuver) — le serveur de `.mcp.json` attend une approbation locale.
- [`claude -p` et modèle](environnement.md#claude--p-et-modèle) — processus sans interface sur le modèle par défaut du CLI.

## Tests
- [Captures pleine page](tests.md#captures-pleine-page) — apparitions au défilement invisibles dans Chromium sans interface.
- [axe après les animations](tests.md#axe-après-les-animations) — contraste transitoire pendant un fondu.
- [Latence des interactions](tests.md#latence-des-interactions) — rendu logiciel : un flou plein écran coûte cher.
