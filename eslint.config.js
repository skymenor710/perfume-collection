// Lint do monorepo. Foco em erros reais (hooks do React, promessas esquecidas não), não em estilo:
// a formatação já é consistente e mudar o estilo agora só geraria ruído no histórico.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-artifact/**', '**/node_modules/**', 'data/**', 'assets/**', 'scripts/.lab/**', 'scripts/.shots/**', '**/public/sw.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      // NBSP de propósito nos regex de preço.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Scripts de teste mandam funções para dentro da página (page.evaluate): lá existe DOM.
    files: ['scripts/**/*.{mjs,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // O núcleo de domínio roda no servidor, no navegador e (no futuro) no celular: nada de DOM.
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'HTMLElement', 'fetch'],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'react/*', 'three', 'node:*'] }],
    },
  },
);
