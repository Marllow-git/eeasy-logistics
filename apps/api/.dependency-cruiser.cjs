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

/**
 * A hand-written DTO by any common spelling (adversary L-8): `x.dto.ts`, `x.dto.tsx`, `x-dto.ts`,
 * or any file under a `dto/` or `dtos/` folder.
 */
const dtoPath = '(?:[.-]dto[.]tsx?$|(?:^|/)dtos?/)';

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
        pathNot: [
          '(?:^|/)modules/kernel/platform/',
          '(?:^|/)src/worker/system/',
          '^src/seed/',
          // The package's own committed-side-effect entry (rule below) wraps the platform pool.
          '(?:^|/)packages/db/src/committed\\.ts$',
        ],
      },
      to: { path: '(?:^|/)packages/db/src/platform\\.ts$' },
    },
    {
      name: 'committed-side-effects-only-in-audit',
      comment:
        'PLAT-6 adversary M-5, PLAT-7 plan 2.4: a transaction committed regardless of the ' +
        "request's outcome (@eeasy-logistics/db/committed) is for refusal audits only, written " +
        'by modules/kernel/audit/ (PLAT-11 adds its security counters here when it lands).',
      severity: 'error',
      from: { pathNot: ['(?:^|/)modules/kernel/audit/', '(?:^|/)packages/db/src/'] },
      to: { path: '(?:^|/)packages/db/src/committed\\.ts$' },
    },
    {
      name: 'db-migrate-only-in-owner-jobs',
      comment:
        'ADR-0031, PLAT-7 adversary M-3 and L-1: @eeasy-logistics/db/migrate opens elx_owner ' +
        'connections; only the migration job (src/migrate/, with the audit partitions), the seed ' +
        'tool (local and ci), /ready for the expected version, the database test harness and ' +
        'packages/db itself import it.',
      severity: 'error',
      from: {
        pathNot: [
          '(?:^|/)src/migrate/',
          '^src/seed/',
          '^src/health/readiness\\.module\\.ts$',
          '^test/(?:integration|schema)/',
          '(?:^|/)packages/db/',
        ],
      },
      to: { path: '(?:^|/)packages/db/src/migrate\\.ts$' },
    },
    {
      name: 'migrate-job-loads-no-application',
      comment:
        'PLAT-7 CI fix: the migration job (src/migrate/) runs before anything else is built ' +
        '(CI migrates before it generates the contracts) and needs packages/config and ' +
        'packages/db only; it never reaches the application modules or the contracts. main.ts ' +
        'imports the Nest graphs of the api and the worker lazily.',
      severity: 'error',
      from: { path: '(?:^|/)(?:src|violations)/migrate/' },
      to: {
        path: [
          '(?:^|/)src/modules/',
          '(?:^|/)src/app\\.module\\.ts$',
          '(?:^|/)packages/contracts/',
          // PLAT-14 plan 2.1: the migrate role stays telemetry-free.
          '(?:^|/)node_modules/@opentelemetry/',
          '(?:^|/)node_modules/@sentry/',
        ],
        reachable: true,
      },
    },
    {
      name: 'main-loads-telemetry-lazily',
      comment:
        'PLAT-14 plan 2.1: main.ts imports the OpenTelemetry SDK and Sentry only with a dynamic ' +
        'import() after the role is known, so `--role migrate` never loads them.',
      severity: 'error',
      from: { path: '(?:^|/)(?:src|violations/main)/main\\.ts$' },
      to: {
        path: [
          '(?:^|/)node_modules/@opentelemetry/',
          '(?:^|/)node_modules/@sentry/',
          '(?:^|/)src/modules/kernel/telemetry/',
        ],
        dynamic: false,
      },
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
      from: { path: dtoPath },
      to: {},
    },
    {
      name: 'no-dto-files',
      comment: 'Doc 3 §9, A-17: importing a *.dto.ts file.',
      severity: 'error',
      from: {},
      to: { path: dtoPath },
    },
    {
      name: 'no-dto-files',
      comment: 'Doc 3 §9, A-17: a *.dto.ts file with no imports and no importers.',
      severity: 'error',
      from: { orphan: true, path: dtoPath },
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
    {
      name: 'contracts-server-entries-only',
      comment:
        'PLAT-6 review round 2: the API image loads controllers and presenters at run time, so ' +
        'they import only the server-safe @eeasy-logistics/contracts/<surface>/schemas entries ' +
        'and /unions, never the barrel entries (fetch client, hooks), /mocks or /http.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/contracts/' },
      to: {
        path: '(?:^|/)packages/contracts/',
        pathNot: '(?:^|/)packages/contracts/(?:src/schemas/[a-z]+|src/unions|generated/.+)[.]ts$',
      },
    },
    ...environmentRules(),
    noUnresolvable,
  ],
  options,
};
