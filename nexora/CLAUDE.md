@AGENTS.md

## Spécifique à Claude Code

- Plugins du projet (`.claude/settings.json`, portée projet) : Superpowers, Ponytail, Caveman. Le plugin `impeccable`
  (design) vient du compte claude.ai ; il lit `PRODUCT.md` et `DESIGN.md` — garder leurs sections d'en-tête.
- Context7 : serveur MCP du projet déclaré dans `.mcp.json` ; à approuver une fois par environnement (au premier
  lancement interactif, ou `.claude/settings.local.json` non versionné — voir la mémoire).
- Compétences du projet : `.claude/skills/` (copiées par le CLI `skills`, verrou `skills-lock.json`, sources et
  licences dans `.claude/skills/SOURCES.md`).
- Sessions claude.ai/code : conteneur éphémère — tout ce qui est installé hors du dépôt (RTK, Graphify, plugins de
  portée utilisateur) disparaît ; seul ce qui est versionné dans `nexora/` persiste.

Index de mémoire du projet (court ; détails chargés à la demande) :

@.claude/memory/MEMORY.md
