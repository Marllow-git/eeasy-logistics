// Shared ESLint flat configuration. Each workspace's eslint.config.js spreads `base`
// (and `react` for React code) and adds only what is specific to it.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { noPhysicalDirectionUtilities } from './rules/no-physical-direction-utilities.js';

const envMessage =
  'Read configuration through @eeasy-logistics/config, never the environment directly (AGENTS.md).';

/** `process.env`, `globalThis.process` and `global.process` (the latter two reach `.env` too). */
const envRestrictions = [
  { object: 'process', property: 'env', message: envMessage },
  { object: 'globalThis', property: 'process', message: envMessage },
  { object: 'global', property: 'process', message: envMessage },
];

/** The only `process` members code outside packages/config may use. */
const allowedProcessMembers = '/^(argv|stdout|stderr|exit|execPath|cwd)$/';
const processModule = '/^(node:)?process$/';

/**
 * Closes the aliasing routes around `process.env`: any other member (`process['env']`,
 * `process.env`), `process` used as a value (`const p = process`, `const { env } = process`,
 * `f(process)`), and `require` or `import()` of the process module.
 */
export const processRestrictions = [
  {
    selector: "MemberExpression[object.type='Identifier'][object.name='process'][computed=true]",
    message: envMessage,
  },
  {
    selector: `MemberExpression[object.type='Identifier'][object.name='process'][computed=false]:not([property.name=${allowedProcessMembers}])`,
    message: `${envMessage} Outside it, process allows only argv, stdout, stderr, exit, execPath and cwd.`,
  },
  {
    selector:
      "Identifier[name='process']:not(MemberExpression > Identifier.object):not(MemberExpression[computed=false] > Identifier.property):not(Property[shorthand=false] > Identifier.key)",
    message: `${envMessage} Do not pass or alias process.`,
  },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${processModule}]`,
    message: envMessage,
  },
  { selector: `ImportExpression[source.value=${processModule}]`, message: envMessage },
];

/**
 * PLAT-5 review M-5 (data §4.2, ADR-0031): only packages/db sets the tenancy setting. Any string or
 * template naming `set_config` or `elx.account_id` elsewhere is code that could set the account
 * itself, which row-level security cannot defend against. packages/db/src and the database tests
 * are exempt in their own ESLint configs.
 */
export const tenancySettingRestrictions = [
  {
    selector: 'Literal[value=/set_config|elx\\.account_id/i]',
    message: 'Only packages/db sets elx.account_id (withUnitOfWork); never set it yourself.',
  },
  {
    selector: 'TemplateElement[value.raw=/set_config|elx\\.account_id/i]',
    message: 'Only packages/db sets elx.account_id (withUnitOfWork); never set it yourself.',
  },
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
      // sees imports only, so the global `process` is restricted here (no `env`, no aliasing, no
      // import or require of the module); packages/config exempts its three entry points.
      'no-restricted-properties': ['error', ...envRestrictions],
      'no-restricted-syntax': ['error', ...processRestrictions, ...tenancySettingRestrictions],
      'no-restricted-imports': [
        'error',
        {
          paths: ['process', 'node:process'].map((name) => ({ name, message: envMessage })),
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // CommonJS config files (dependency-cruiser) load the shared rule set with require().
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Last: turn off every stylistic rule Prettier owns.
  prettier,
);

/**
 * WEB-1 plan 2.3 (web §5, ADR-0033): logical Tailwind utilities only, in packages/ui, apps/web
 * and apps/admin. See rules/no-physical-direction-utilities.js.
 */
export const logicalCss = defineConfig({
  files: ['**/*.{ts,tsx,js,jsx}'],
  plugins: {
    eeasy: { rules: { 'no-physical-direction-utilities': noPhysicalDirectionUtilities } },
  },
  rules: { 'eeasy/no-physical-direction-utilities': 'error' },
});

export const react = defineConfig({
  files: ['**/*.tsx', '**/*.jsx'],
  extends: [reactHooks.configs.flat.recommended],
  languageOptions: { globals: { ...globals.browser } },
});
