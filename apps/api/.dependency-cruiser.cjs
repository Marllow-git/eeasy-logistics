// Architecture test for the bounded contexts (ADR-0026) and the A-17 contract rules (doc 3 §9).
// Run: pnpm --filter api test:architecture. It cruises src/ and test/architecture/fixture/; the
// fixture tree there mirrors src/modules with permitted imports. test/architecture/violations/
// holds one file per A-17 rule that must fail; test/architecture-violations.test.ts cruises it
// and asserts each rule fires.
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
        '(modules/kernel/platform/), the worker system jobs (src/worker/system/) and the seed ' +
        'tool (src/seed/, local and ci only).',
      severity: 'error',
      from: {
        pathNot: ['(?:^|/)modules/kernel/platform/', '(?:^|/)src/worker/system/', '^src/seed/'],
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
    {
      name: 'no-validation-libraries',
      comment:
        'Doc 3 §9 "Enforcement", roadmap A-17: API input is parsed only by the kernel ' +
        'ContractPipe with the generated strict schemas, and the YAML is the only description of ' +
        'the API: no class-validator, class-transformer, nestjs-zod or @nestjs/swagger.',
      severity: 'error',
      from: {},
      to: {
        path: [
          '^(?:class-validator|class-transformer|nestjs-zod|@nestjs/swagger)(?:/|$)',
          '(?:^|/)node_modules/(?:class-validator|class-transformer|nestjs-zod|@nestjs/swagger)/',
        ],
      },
    },
    {
      name: 'no-dto-files',
      comment:
        'Doc 3 §9 "Enforcement", A-17: no hand-written DTO; request and response shapes are the ' +
        'generated types of @eeasy-logistics/contracts. A *.dto.ts file fails whether it imports, ' +
        'is imported or stands alone (the orphan rule below).',
      severity: 'error',
      from: { path: '\\.dto\\.ts$' },
      to: {},
    },
    {
      name: 'no-dto-files',
      comment: 'Doc 3 §9, A-17: importing a *.dto.ts file.',
      severity: 'error',
      from: {},
      to: { path: '\\.dto\\.ts$' },
    },
    {
      name: 'no-dto-files',
      comment: 'Doc 3 §9, A-17: a *.dto.ts file with no imports and no importers.',
      severity: 'error',
      from: { orphan: true, path: '\\.dto\\.ts$' },
      to: {},
    },
    {
      name: 'contracts-only-in-controllers-and-presenters',
      comment:
        'Doc 3 §9 "Contract code stops at the edge", A-17: the generated types and schemas of ' +
        '@eeasy-logistics/contracts are imported only by *.controller.ts and *.presenter.ts ' +
        'files; services, repositories and Drizzle schemas keep their own types.',
      severity: 'error',
      from: {
        pathNot: ['\\.controller\\.ts$', '\\.presenter\\.ts$', '(?:^|/)packages/contracts/'],
      },
      to: { path: '(?:^|/)packages/contracts/' },
    },
    ...environmentRules(),
    noUnresolvable,
  ],
  options,
};
