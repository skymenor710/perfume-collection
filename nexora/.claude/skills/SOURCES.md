# Compétences du projet — sources, licences, mise à jour

Copiées (pas de lien symbolique) par `npx --yes skills@1.7.2 add … --agent claude-code --yes` le 18/10/2026 ;
empreintes dans `skills-lock.json`. Contenu tiers : ne pas modifier ici ; mettre à jour depuis la source.

| Compétence | Source (révision observée) | Licence | Rôle dans Nexora |
| --- | --- | --- | --- |
| `web-design-guidelines` | vercel-labs/agent-skills `skills/web-design-guidelines` (063bee9) | MIT (dépôt vercel-labs/agent-skills) | revue d'interface et d'accessibilité ; récupère les règles à jour sur raw.githubusercontent.com à chaque usage |
| `supabase-postgres-best-practices` | supabase/agent-skills `skills/supabase-postgres-best-practices` (c9be0e9) | MIT, © 2026 Supabase | schéma, SQL, index, migrations PostgreSQL ; n'adopte ni Supabase ni RLS |
| `differential-review` | trailofbits/skills `plugins/differential-review/skills/differential-review` (5c99c03) | CC BY-SA 4.0, © Trail of Bits — attribution conservée, modifications à partager sous la même licence | revue de sécurité d'un diff ; l'agent `adversarial-modeler` du plugin d'origine n'est pas installé (étape faite en ligne) |

Mise à jour : `npx --yes skills@<version> update --project --yes`, puis relire le diff et `skills-lock.json`.
Lister : `npx --yes skills@<version> list --agent claude-code`.
