// Architecture test for the web app (web §2.2): the browser app reaches the API only through
// packages/contracts and never touches a database, Redis, the object store or the API's code; it
// reads configuration only through @eeasy-logistics/config/web (PLAT-4).
// Run: pnpm --filter web test:architecture (cruises src/ and next.config.ts)
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

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
      name: 'web-contracts-surfaces',
      comment:
        'PLAT-15: the web app imports @eeasy-logistics/contracts only through /staff, /recipient, ' +
        '/http and /unions. /platform belongs to the admin app (ADR-0038); /driver and ' +
        '/public belong to other clients; /<surface>/mocks are for tests, never for src.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/contracts/' },
      to: { path: '(?:^|/)packages/contracts/(?!src/(?:staff|recipient|http|unions)\\.ts$)' },
    },
    {
      name: 'web-no-admin-code-or-catalogue',
      comment:
        'ADR-0038, WEB-1 leg 2: the platform console is a separate app; apps/web never imports ' +
        'apps/admin, so its `platform` catalogue (apps/admin/messages) cannot reach this build.',
      severity: 'error',
      from: {},
      to: { path: ['(?:^|/)apps/admin/', '^\\.\\./admin/'] },
    },
    ...environmentRules({ configEntry: 'web.ts' }),
    noUnresolvable,
  ],
  options,
};
