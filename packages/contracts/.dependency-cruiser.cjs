// Architecture test (PLAT-4): no process-module import. Run: pnpm test:architecture
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'server-safe-schemas-entries',
      comment:
        'PLAT-6 review round 2, A-17: src/schemas/<surface>.ts is what apps/api loads at run time; ' +
        'nothing it reaches may be the fetch client, the hooks, the MSW handlers, the fetcher or ' +
        'their browser and test dependencies.',
      severity: 'error',
      from: { path: '^src/schemas/' },
      to: {
        reachable: true,
        path: [
          '^generated/[^/]+/(?:client|hooks|hooks[.]msw)[.]ts$',
          '^src/http[.]ts$',
          '(?:^|/)node_modules/(?:@tanstack|msw|@faker-js)/',
        ],
      },
    },
    ...environmentRules(),
    noUnresolvable,
  ],
  options,
};
