// Shared ESLint flat configuration. Each workspace's eslint.config.js spreads `base`
// (and `react` for React code) and adds only what is specific to it.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const envMessage =
  'Read configuration through @eeasy-logistics/config, never the environment directly (AGENTS.md).';

/** `process.env`, `globalThis.process` and `global.process` (the latter two reach `.env` too). */
const envRestrictions = [
  { object: 'process', property: 'env', message: envMessage },
  { object: 'globalThis', property: 'process', message: envMessage },
  { object: 'global', property: 'process', message: envMessage },
];

export const base = defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/.expo/**',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.cjs', '*.mjs', '*.config.ts'] },
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      // AGENTS.md hard rule (PLAT-4): only packages/config reads the environment. dependency-cruiser
      // sees imports only, so the global `process.env` is forbidden here; packages/config exempts
      // its documented entry points.
      'no-restricted-properties': ['error', ...envRestrictions],
      'no-restricted-imports': [
        'error',
        {
          paths: ['process', 'node:process'].map((name) => ({
            name,
            importNames: ['env'],
            message: envMessage,
          })),
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Last: turn off every stylistic rule Prettier owns.
  prettier,
);

export const react = defineConfig({
  files: ['**/*.tsx', '**/*.jsx'],
  extends: [reactHooks.configs.flat.recommended],
  languageOptions: { globals: { ...globals.browser } },
});
