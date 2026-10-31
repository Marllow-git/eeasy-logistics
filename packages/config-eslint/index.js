// Shared ESLint flat configuration. Each workspace's eslint.config.js spreads `base`
// (and `react` for React code) and adds only what is specific to it.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
        projectService: { allowDefaultProject: ['*.js', '*.cjs', '*.mjs'] },
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
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
