// Architecture test (PLAT-4): no process-module import. Run: pnpm test:architecture
const {
  environmentRules,
  noUnresolvable,
  options,
} = require('../../dependency-cruiser.shared.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = { forbidden: [...environmentRules(), noUnresolvable], options };
