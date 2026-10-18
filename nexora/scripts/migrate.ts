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

const rt = await bootstrap({ migrate: true });
console.log('Migrations appliquées.');
await rt.close();
