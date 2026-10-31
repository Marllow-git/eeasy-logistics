// Architecture test for the bounded contexts (ADR-0026). Run: pnpm --filter api test:architecture
// It cruises src/ and test/architecture/; the fixture tree there mirrors src/modules so the rules
// can be shown to pass on permitted imports and fail on violations.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'kernel-imports-no-context',
      comment:
        'ADR-0026: the shared kernel imports no bounded context, not even its public folder.',
      severity: 'error',
      from: { path: '(?:^|/)modules/kernel/' },
      to: { path: '(?:^|/)modules/(?:delivery|wms)/' },
    },
    {
      name: 'context-imports-another-only-via-public',
      comment:
        'ADR-0026: a context imports another context only from modules/<context>/public/. ' +
        '$1 is the importing context, so imports inside the same context stay allowed.',
      severity: 'error',
      from: { path: '(?:^|/)modules/([^/]+)/' },
      to: {
        path: '(?:^|/)modules/[^/]+/',
        pathNot: ['(?:^|/)modules/$1/', '(?:^|/)modules/[^/]+/public/'],
      },
    },
    {
      name: 'no-environment-outside-config',
      comment:
        'AGENTS.md hard rule, PLAT-4: only packages/config reads the environment. Forbids importing ' +
        'the process module (`import { env } from "node:process"`) outside it. A global ' +
        '`process.env` is not an import, so the shared ESLint rule no-restricted-properties catches it.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/config/' },
      to: { dependencyTypes: ['core'], path: '^(?:node:)?process$' },
    },
    {
      name: 'no-unresolvable',
      comment: 'An import the cruiser cannot resolve could hide a boundary violation.',
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
      // Workspace packages resolve through their package.json `exports` (@eeasy-logistics/config/node).
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
  },
};
