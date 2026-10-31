// Architecture test for the bounded contexts (ADR-0026). Run: pnpm --filter api test:architecture
// It cruises src/ and test/architecture/; the fixture tree there mirrors src/modules so the rules
// can be shown to pass on permitted imports and fail on violations.
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
    ...environmentRules(),
    noUnresolvable,
  ],
  options,
};
