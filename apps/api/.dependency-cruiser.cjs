// Architecture test for the bounded contexts (ADR-0026). Run: pnpm --filter api test:architecture
// It cruises src/ and test/architecture/; the fixture tree there mirrors src/modules so the rules
// can be shown to pass on permitted imports and fail on violations.
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

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
      name: 'platform-pool-only-in-platform-code',
      comment:
        'ADR-0031, data §4.4, PLAT-5 plan 2.5: the elx_platform pool and unscoped() ' +
        '(@eeasy-logistics/db/platform) are imported only by the platform module ' +
        '(modules/kernel/platform/) and the worker system jobs (src/worker/system/).',
      severity: 'error',
      from: {
        pathNot: ['(?:^|/)modules/kernel/platform/', '(?:^|/)src/worker/system/'],
      },
      to: { path: '(?:^|/)packages/db/src/platform\\.ts$' },
    },
    {
      name: 'db-testing-only-in-tests',
      comment:
        'PLAT-5 plan 2.5: the test-only context setter (@eeasy-logistics/db/testing) never ' +
        'reaches application code; the request guard (PLAT-6) owns the real one.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { path: '(?:^|/)packages/db/src/testing\\.ts$' },
    },
    {
      name: 'db-admin-only-in-tooling',
      comment:
        'PLAT-5 plan 2.8: the superuser helpers (@eeasy-logistics/db/admin: create and drop ' +
        'databases) serve the seed tool (src/seed/) and the test harness only.',
      severity: 'error',
      from: { path: '^src/', pathNot: ['^src/seed/', '\\.test\\.ts$'] },
      to: { path: '(?:^|/)packages/db/src/admin\\.ts$' },
    },
    ...environmentRules(),
    noUnresolvable,
  ],
  options,
};
