import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build artefacts and auto-generated WASM glue — nothing to enforce there.
  globalIgnores([
    'dist',
    'src/engine/wasm-rs/**',
    'public/stockfish/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Allow unused args prefixed with underscore (callback signatures
      // we accept but don't read) and uppercase / underscored vars
      // (constants, mock placeholders).
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
      }],
    },
  },
  // Vitest test files — relax rules that don't apply in tests (Node
  // globals, free use of describe/it from vitest).
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
