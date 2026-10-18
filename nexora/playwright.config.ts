import { defineConfig, devices } from '@playwright/test';

// Tests de bout en bout sur le build de production (lancer `npm run build` avant).
// Navigateur : Chromium installé dans l'environnement (CHROMIUM_PATH) ou celui de Playwright.
// Deux projets : « desktop » (parcours complet, plusieurs largeurs) et « mobile » (téléphone tactile émulé).
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    launchOptions,
    locale: 'fr-FR',
    trace: 'off',
  },
  projects: [
    { name: 'desktop', testMatch: 'site.spec.ts', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: 'mobile.spec.ts', use: { ...devices['Pixel 7'], launchOptions } },
  ],
});
