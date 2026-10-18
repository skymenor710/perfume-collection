// Lint rapide de Nexora (sans information de type). Adapté du profil générique du Vibe Coding Toolkit
// (templates/eslint/eslint.config.mjs.example, révision de66fe3). Les règles qui demandent le vérificateur de types
// sont dans eslint.config.typed.mjs (npm run lint:typed). Règles locales quality/* : eslint-rules/ (copie exacte),
// auto-test : npm run lint:rules. Sévérités et décomptes à l'adoption : docs/quality.md.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import quality from './eslint-rules/index.cjs';

const code = '**/*.{js,mjs,cjs,ts,mts,cts,tsx}';
// Fichiers de test : par suffixe, par dossier, et tout tests/ (aides et serveur de test compris).
const testFiles = [
  '**/*{.,-}{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
  '**/{__tests__,__mocks__,fixtures,mocks}/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
  'tests/**/*.{ts,mts,mjs}',
];
// Outils en ligne de commande : leur sortie console EST leur interface.
const cliFiles = ['scripts/**/*.{ts,mjs}', 'assets-src/**/*.mjs'];

export default defineConfig([
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strict,

  {
    // Code du navigateur, et scripts qui envoient des fonctions dans une page (page.evaluate).
    files: ['src/client/**/*.ts', 'scripts/**/*.mjs', 'assets-src/**/*.mjs', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },

  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'import-x/no-unresolved': 'error',
      'import-x/no-duplicates': 'error',
      // Frontières d'architecture (docs/architecture.md § Frontières et flux).
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // Les gabarits ne touchent pas la base (connexion, données de démonstration) : ils reçoivent des données
            // déjà préparées. Les types du schéma restent importables.
            { target: './src/server/views/**/*', from: ['./src/server/db/client.ts', './src/server/db/seed.ts'] },
            // Le code du navigateur n'importe jamais le serveur (secrets, base, configuration).
            { target: './src/client/**/*', from: './src/server/**/*' },
          ],
        },
      ],
    },
  },

  {
    files: [code],
    plugins: { quality },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Espaces insécables voulus dans les textes français des gabarits (typographie) ; interdits ailleurs.
      'no-irregular-whitespace': ['error', { skipJSXText: true }],
      // Adoption : 99 assertions non nulles existantes (18/10/2026) → « warn » ; plan dans docs/quality.md.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Budget de taille et de complexité : « warn » par principe (sujet de discussion, pas une barrière) ;
      // passer une règle à « error » quand son décompte atteint zéro.
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-statements': ['warn', 20],
      'max-params': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['warn', 3],
      'quality/max-lines': 'error',
      'quality/no-direct-console': ['error', { logger: 'le journal pino (deps.log, src/server/log.ts)' }],
      'quality/no-direct-data-access': [
        'error',
        {
          modules: ['../db/client', '../../db/client', '../db/schema', '../../db/schema'],
          bindings: ['db', 'openDb'],
          layers: ['/src/server/views/', '/src/client/'],
        },
      ],
    },
  },
  {
    // Après le bloc qui active la règle (le dernier bloc l'emporte). Outils CLI ; et la fonction Netlify, qui doit
    // signaler un échec de démarrage avant que le journal pino n'existe.
    files: [...cliFiles, 'netlify/functions/site.mts'],
    rules: { 'quality/no-direct-console': 'off' },
  },
  {
    files: testFiles,
    plugins: { quality },
    rules: {
      'quality/max-lines': ['warn', { includeTests: true }],
      'max-statements': 'off',
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off',
      'import-x/no-restricted-paths': 'off',
    },
  },
  {
    files: ['eslint-rules/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'readonly', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  globalIgnores([
    '.claude/**',
    'node_modules/**',
    'dist/**',
    'data/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
    'reports/**',
    '.netlify/**',
    'graphify-out/**',
    'assets-src/logo4k/out/**',
    'brand/**',
    'public/**',
    'seed/**',
    '**/*.tsbuildinfo',
  ]),
]);
