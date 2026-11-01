// Architecture test for the admin app (WEB-19 decision 2.9; web §2.2, ADR-0038): the platform
// console reaches the API only through packages/contracts and never touches a database, Redis, the
// object store or the API's code; it reads configuration only through @eeasy-logistics/config/web.
// Run: pnpm --filter admin test:architecture (cruises src/, tests/ and next.config.ts)
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
      name: 'admin-no-server-side-data-access',
      comment: 'web §2.2: no import of apps/api, drizzle-orm, pg, ioredis or an S3 SDK.',
      severity: 'error',
      from: {},
      to: {
        path: [
          `(?:^|/)node_modules/${forbiddenPackages}/`,
          `^${forbiddenPackages}(?:/|$)`,
          '(?:^|/)apps/api/',
          // Paths are relative to apps/admin, so a relative import of the API resolves to ../api/.
          '^\\.\\./api/',
        ],
      },
    },
    ...environmentRules({ configEntry: 'web.ts' }),
    noUnresolvable,
  ],
  options,
};
