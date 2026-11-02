// createDriver (DEL-4 item F): without a session the door is unauthenticated (401). Signed-in and
// forbidden scenarios need a seeded account and staff session, which the contract run has no
// fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const SITE = '00000000-0000-7000-8000-000000000044';

const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001401' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.createDriver(
      { name: 'Driver', phone: '+966551234567', home_site_id: SITE },
      { fetcher, headers: KEY },
    ),
});
