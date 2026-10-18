# Compétences du projet — sources, licences, mise à jour

Copiées (pas de lien symbolique) par `npx --yes skills@1.7.2 add … --agent claude-code --yes` le 18/10/2026 ;
empreintes dans `skills-lock.json`. Contenu tiers : ne pas modifier ici ; mettre à jour depuis la source, sauf les
deux modifications locales ci-dessous (constats de la revue du 18/10/2026), à réappliquer après chaque mise à jour.

| Compétence | Source (révision observée) | Licence | Rôle dans Nexora |
| --- | --- | --- | --- |
| `web-design-guidelines` | vercel-labs/agent-skills `skills/web-design-guidelines` (063bee9) | MIT (dépôt vercel-labs/agent-skills) | revue d'interface et d'accessibilité ; récupère les règles à jour sur raw.githubusercontent.com à chaque usage |
| `supabase-postgres-best-practices` | supabase/agent-skills `skills/supabase-postgres-best-practices` (c9be0e9) | MIT, © 2026 Supabase | schéma, SQL, index, migrations PostgreSQL ; n'adopte ni Supabase ni RLS |
| `differential-review` | trailofbits/skills `plugins/differential-review/skills/differential-review` (5c99c03) | CC BY-SA 4.0, © Trail of Bits — attribution conservée, modifications à partager sous la même licence | revue de sécurité d'un diff ; l'agent `adversarial-modeler` du plugin d'origine n'est pas installé (étape faite en ligne) |

## Modifications locales

- `web-design-guidelines/SKILL.md` : URL des règles épinglée sur le commit `434b7f9` de
  vercel-labs/web-interface-guidelines au lieu de `main` (sinon, quiconque modifie ce fichier amont oriente l'agent).
  Pour suivre l'amont : relire le diff du fichier, puis changer le commit.
- `differential-review/SKILL.md` : `allowed-tools` restreint à la lecture (`Read`, `Grep`, `Glob`, `git diff/log/show/blame`)
  au lieu de `Read Write Grep Glob Bash` ; écrire le rapport ou changer de commit (`git checkout`) passe par
  l'autorisation normale. Modification partagée sous la même licence (CC BY-SA 4.0).

Ces fichiers ne correspondent donc plus aux empreintes de `skills-lock.json` (rien ne les vérifie automatiquement).

Mise à jour : `npx --yes skills@<version> update --project --yes`, puis relire le diff et `skills-lock.json`.
Lister : `npx --yes skills@<version> list --agent claude-code`.
