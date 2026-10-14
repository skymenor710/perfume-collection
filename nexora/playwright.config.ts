import { defineConfig } from '@playwright/test';

// Tests de bout en bout sur le build de production (lancer `npm run build` avant).
// Navigateur : Chromium installé dans l'environnement (CHROMIUM_PATH) ou celui de Playwright.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    locale: 'fr-FR',
    trace: 'off',
  },
});
