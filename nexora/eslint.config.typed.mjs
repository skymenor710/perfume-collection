// Contrôle asynchrone ciblé (avec information de type), lancé à part : npm run lint:typed.
// Adapté de templates/eslint/next.typed.config.mjs.example (Vibe Coding Toolkit, révision de66fe3).
import defaultConfig from './eslint.config.mjs';

export default [
  ...defaultConfig,
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts', 'tests/**/*.ts', 'netlify/**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Promesse oubliée ou passée là où un retour synchrone est attendu.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
];
