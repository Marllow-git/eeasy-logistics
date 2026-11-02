// updateSite (PLAT-12 item G): without a session the door is unauthenticated (401). Signed-in and
// forbidden scenarios need a seeded account and staff session, which the contract run has no
// fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.updateSite(
      '00000000-0000-7000-8000-000000000001',
      { kind: 'branch', name_ar: 'فرع', name_en: 'Branch' },
      { fetcher, headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000001213' } },
    ),
});
