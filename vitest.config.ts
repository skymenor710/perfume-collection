import { defineConfig } from 'vitest/config';

// Logs estruturados em silêncio durante os testes (os testes de log criam o próprio logger).
export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
  },
});
