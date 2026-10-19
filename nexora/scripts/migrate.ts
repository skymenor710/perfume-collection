// Applique les migrations SQL versionnées (dossier drizzle/). Sans effet si la base est à jour.
import { bootstrap } from '../src/server/bootstrap';
import { serverlessProblems } from '../src/server/serverless';

// Build Netlify : on refuse de « réussir » une migration sur une base PGlite locale qui disparaîtrait avec le build.
if (process.env.NETLIFY === 'true') {
  const problems = serverlessProblems();
  if (problems.length) {
    console.error(`Configuration Netlify incomplète :\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
}

// Aperçus et déploiements de branche (CONTEXT ≠ production) : jamais de migration. Ils partagent souvent la
// DATABASE_URL de production ; un schéma en avance casserait le site publié. CONTEXT absent : exécution locale.
const context = process.env.CONTEXT;
if (process.env.NETLIFY === 'true' && context && context !== 'production') {
  console.log(`Contexte Netlify « ${context} » : migrations non appliquées (production uniquement).`);
  process.exit(0);
}

const rt = await bootstrap({ migrate: true });
console.log('Migrations appliquées.');
await rt.close();
