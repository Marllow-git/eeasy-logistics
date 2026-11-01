// Architecture test for the driver app (PLAT-4): no process-module import, and configuration only
// through @eeasy-logistics/config/driver (EXPO_PUBLIC_* values). PLAT-15: contracts only through the
// driver, http and unions entry points (no hooks, no MSW, no other surface).
// Run: pnpm --filter driver test:architecture
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'driver-contracts-surfaces',
      comment:
        'PLAT-15: the driver app imports @eeasy-logistics/contracts only through /driver, /http ' +
        'and /unions (driver app §1); hooks, MSW handlers and other surfaces stay out.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/contracts/' },
      to: { path: '(?:^|/)packages/contracts/(?!src/(?:driver|http|unions)\\.ts$)' },
    },
    ...environmentRules({ configEntry: 'driver.ts' }),
    noUnresolvable,
  ],
  options,
};
