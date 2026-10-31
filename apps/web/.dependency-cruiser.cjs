// Architecture test for the web app (web §2.2): the browser app reaches the API only through
// packages/contracts and never touches a database, Redis, the object store or the API's code.
// Run: pnpm --filter web test:architecture
const forbiddenPackages = '(?:drizzle-orm|pg|ioredis|@aws-sdk/[^/]+|@eeasy-logistics/api)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'web-no-server-side-data-access',
      comment: 'web §2.2: no import of apps/api, drizzle-orm, pg, ioredis or an S3 SDK.',
      severity: 'error',
      from: {},
      to: {
        path: [
          `(?:^|/)node_modules/${forbiddenPackages}/`,
          `^${forbiddenPackages}(?:/|$)`,
          '(?:^|/)apps/api/',
          // Paths are relative to apps/web, so a relative import of the API resolves to ../api/.
          '^\\.\\./api/',
        ],
      },
    },
    {
      name: 'no-environment-outside-config',
      comment:
        'AGENTS.md hard rule, PLAT-4: only packages/config reads the environment. Forbids importing ' +
        'the process module outside it; a global `process.env` read is caught by the shared ESLint ' +
        'rule no-restricted-properties.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/config/' },
      to: { dependencyTypes: ['core'], path: '^(?:node:)?process$' },
    },
    {
      name: 'web-imports-only-public-config',
      comment:
        'PLAT-4: the web app reads configuration only through @eeasy-logistics/config/web ' +
        '(NEXT_PUBLIC_* values); the package root and /node are server code holding secrets.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '(?:^|/)packages/config/src/(?!web\\.ts$)' },
    },
    {
      name: 'no-unresolvable',
      comment: 'An import the cruiser cannot resolve could hide a forbidden one.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
  },
};
