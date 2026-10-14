import { defineConfig } from 'drizzle-kit';

// Génère les migrations SQL versionnées (dossier drizzle/) à partir de src/server/db/schema.ts.
// `npm run db:generate` — n'a besoin d'aucune base.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
});
