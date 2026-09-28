import { defineConfig } from 'drizzle-kit';

/**
 * Só GERA migrations a partir do schema (`npm run db:generate`) — não conecta em banco nenhum.
 * Aplicar é `npm run db:migrate` (scripts próprios, que nunca imprimem a URL). `drizzle-kit push` não é usado:
 * todo ambiente (dev, staging, produção) recebe exatamente os mesmos arquivos SQL, na mesma ordem.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
