import { defineConfig } from 'vitest/config';

// Logs estruturados em silêncio durante os testes (os testes de log criam o próprio logger).
export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
    // nexora/ é um projeto independente (site da Nexora) com testes próprios: `cd nexora && npm test`.
    exclude: ['**/node_modules/**', '**/dist/**', 'nexora/**'],
  },
});
