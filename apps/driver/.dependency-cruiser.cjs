// Architecture test for the driver app (PLAT-4): no process-module import, and configuration only
// through @eeasy-logistics/config/driver (EXPO_PUBLIC_* values). PLAT-15: contracts only through the
// driver, http and unions entry points (no hooks, no other surface); /driver/mocks only from tests.
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
        'and /unions (driver app §1), and /driver/mocks in tests; hooks and other surfaces stay out.',
      severity: 'error',
      from: { pathNot: '(?:^|/)packages/contracts/' },
      to: {
        path: '(?:^|/)packages/contracts/(?!src/(?:driver|http|unions|mocks/driver)\\.ts$)',
      },
    },
    {
      name: 'driver-contracts-mocks-in-tests-only',
      comment:
        'PLAT-15 plan 2.12 (A-17): /driver/mocks (MSW handlers, faker factories) is for tests; app ' +
        'code never imports it.',
      severity: 'error',
      from: { pathNot: ['(?:^|/)packages/contracts/', '(?:^|/)test/', '\\.test\\.tsx?$'] },
      to: { path: '(?:^|/)packages/contracts/src/mocks/' },
    },
    // DRV-1 plan 2.1, driver app §2: UI (app/, src/ui) → domain, sync, i18n, observability;
    // sync → platform and domain; platform → nothing of ours; domain → nothing with I/O.
    {
      name: 'driver-ui-not-on-adapters',
      comment:
        'Driver app §2: the UI never touches a platform adapter (storage, crypto, the database); it ' +
        'goes through src/sync. The one exception is src/platform/permissions.ts: an OS prompt is UI.',
      severity: 'error',
      from: { path: '^(?:app|src/ui)/' },
      to: {
        path: [
          '^src/platform/(?!permissions\\.ts$)',
          'node_modules/(?:expo-secure-store|expo-sqlite|expo-crypto|react-native-quick-crypto)/',
        ],
      },
    },
    {
      name: 'driver-platform-depends-on-nothing-of-ours',
      comment: 'Driver app §2: platform adapters sit on the OS only.',
      severity: 'error',
      from: { path: '^src/platform/' },
      to: { path: '^(?:app|src/(?!platform/))' },
    },
    {
      name: 'driver-sync-below-ui',
      comment: 'Driver app §2: the sync layer serves the UI and never imports it (nor i18n).',
      severity: 'error',
      from: { path: '^src/sync/' },
      to: { path: '^(?:app|src/(?:ui|i18n|observability))/' },
    },
    {
      name: 'driver-domain-is-pure',
      comment: 'Driver app §2: the domain has no I/O of its own: no adapter, no sync, no UI.',
      severity: 'error',
      from: { path: '^src/domain/' },
      to: { path: ['^(?:app|src/(?!domain/))', 'node_modules/(?:expo-|react-native)'] },
    },
    {
      name: 'driver-pin-never-in-sqlite',
      comment:
        'Driver app §5.2, ADR-0034: the PIN and its verifier never reach SQLite. The modules that ' +
        'hold them import neither the database adapter nor expo-sqlite.',
      severity: 'error',
      from: {
        path: [
          '^src/sync/(?:pin-verifier|cash-pin)\\.ts$',
          '^app/\\(setup\\)/pin\\.tsx$',
          '^src/ui/keypad\\.tsx$',
        ],
      },
      to: { path: ['^src/platform/database\\.ts$', 'node_modules/expo-sqlite/'] },
    },
    ...environmentRules({ configEntry: 'driver.ts' }),
    noUnresolvable,
  ],
  options,
};
