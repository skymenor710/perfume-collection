# Environnement

## Conteneur éphémère
- Fait : les sessions claude.ai/code tournent dans un conteneur recyclé ; tout ce qui est hors du dépôt (RTK,
  Graphify, plugins de portée utilisateur, `~/.config`) disparaît. Plugins et MCP du projet sont déclarés dans
  `nexora/.claude/settings.json` et `.mcp.json`, donc rechargés.
- Source : mise en place de l'outillage, 18/10/2026 (`docs/setup.md`). Dernière vérification : 18/10/2026.
- Invalider si : la session tourne sur une machine personnelle ou un environnement persistant.

## Proxy GitHub
- Fait : depuis le conteneur, `api.github.com` et `github.com/<repo>/releases` répondent 403 ; `git clone` /
  `git ls-remote` fonctionnent. RTK a donc été compilé depuis l'étiquette officielle (`cargo build --release --locked`,
  ~5 min) au lieu de télécharger le binaire.
- Source : essais du 18/10/2026. Dernière vérification : 18/10/2026.
- Invalider si : un téléchargement de release GitHub réussit (politique réseau changée).

## Context7 à approuver
- Fait : `claude mcp list` affiche « Pending approval » pour le serveur `context7` de `.mcp.json` tant qu'il n'est pas
  approuvé dans l'environnement : au premier lancement interactif, ou par `.claude/settings.local.json`
  (`{"enabledMcpjsonServers": ["context7"]}`, non versionné). Une fois approuvé, une vraie requête a fonctionné.
- Source : validation du 18/10/2026. Dernière vérification : 18/10/2026.
- Invalider si : `claude mcp list` montre le serveur connecté dès une nouvelle session sans approbation.

## `claude -p` et modèle
- Fait : un `claude -p` lancé depuis la session utilise le modèle par défaut du CLI (visible dans le message `init` de
  `--output-format stream-json`), pas celui de la session ; le champ `time_to_request_from_spawn_ms` du JSON ne mesure pas le démarrage (démarrage réel
  ~6 s dans `nexora/`, ~4,5 s sans le projet).
- Source : essais du 18/10/2026. Dernière vérification : 18/10/2026.
- Invalider si : une version du CLI transmet le modèle de la session aux processus enfants.
