// Shared dependency-cruiser rules and options (PLAT-4). Every workspace's .dependency-cruiser.cjs
// requires this file, so the environment rule is written once and runs in every `test:architecture`.
// dependency-cruiser sees imports only: a global `process.env` read is caught by the shared ESLint
// rules in packages/config-eslint, which also forbid aliasing `process`.

/**
 * Rules for every workspace. `configEntry` is the only `packages/config/src/` file the workspace may
 * import directly (`web.ts` for apps/web, `driver.ts` for apps/driver); omit it for server code.
 * `databaseDriver` is true only for packages/db, the one workspace that may open connections.
 * @param {{ configEntry?: string, databaseDriver?: boolean }} [options]
 * @returns {import('dependency-cruiser').IForbiddenRuleType[]}
 */
function environmentRules({ configEntry, databaseDriver = false } = {}) {
  /** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
  const rules = [
    {
      name: 'no-environment-outside-config',
      comment:
        'AGENTS.md hard rule, PLAT-4: configuration comes from @eeasy-logistics/config. No file ' +
        'imports or requires the process module (`node:process`); packages/config itself reads ' +
        'the global in its three entry points only.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(?:node:)?process$' },
    },
  ];
  if (!databaseDriver) {
    rules.push({
      name: 'database-driver-only-in-packages-db',
      comment:
        'PLAT-5 review M-2, ADR-0031: only packages/db opens database connections (pools per ' +
        'role, the unit of work, the migration runner). Elsewhere, importing postgres or ' +
        'drizzle-orm/postgres-js would make a pool that skips the role checks and the tenancy ' +
        'setting.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/db/' },
      to: {
        path: ['node_modules/postgres/', 'node_modules/drizzle-orm/postgres-js/'],
      },
    });
  }
  if (configEntry !== undefined) {
    const entry = configEntry.replace(/[.]/g, '\\.');
    rules.push({
      name: 'only-public-config-entry',
      comment:
        `PLAT-4: this app reads configuration only through packages/config/src/${configEntry} ` +
        '(public values); the package root and /node are server code holding secrets.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/config/' },
      to: { path: `(?:^|/)packages/config/src/(?!${entry}$)` },
    });
  }
  return rules;
}

/** @type {import('dependency-cruiser').IForbiddenRuleType} */
const noUnresolvable = {
  name: 'no-unresolvable',
  comment: 'An import the cruiser cannot resolve could hide a forbidden one.',
  severity: 'error',
  from: {},
  to: { couldNotResolve: true },
};

/** @type {import('dependency-cruiser').ICruiseOptions} */
const options = {
  doNotFollow: { path: 'node_modules' },
  tsPreCompilationDeps: true,
  tsConfig: { fileName: 'tsconfig.json' },
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default', 'types'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
};

module.exports = { environmentRules, noUnresolvable, options };
