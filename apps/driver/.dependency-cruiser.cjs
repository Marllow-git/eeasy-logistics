// Architecture test for the driver app (PLAT-4): no process-module import, and configuration only
// through @eeasy-logistics/config/driver (EXPO_PUBLIC_* values).
// Run: pnpm --filter driver test:architecture
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [...environmentRules({ configEntry: 'driver.ts' }), noUnresolvable],
  options,
};
