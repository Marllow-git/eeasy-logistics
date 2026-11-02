// getShift (DEL-5 item E): without a session the door is unauthenticated (401). Signed-in and
// forbidden scenarios need a seeded account and staff session, which the contract run has no
// fixture for; the HTTP suites of apps/api (shifts.http) cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const SHIFT = '00000000-0000-7000-8000-000000000052';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) => client.getShift(SHIFT, { fetcher }),
});
