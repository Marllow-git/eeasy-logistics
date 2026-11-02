// planShift (DEL-5 item E): without a session the door is unauthenticated (401). Signed-in and
// forbidden scenarios need a seeded account and staff session, which the contract run has no
// fixture for; the HTTP suites of apps/api (shifts.http) cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const DRIVER = '00000000-0000-7000-8000-000000000053';
const SITE = '00000000-0000-7000-8000-000000000054';
const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001505' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.planShift(
      {
        driver_id: DRIVER,
        site_id: SITE,
        planned_start: '2026-11-03T05:00:00Z',
        planned_end: '2026-11-03T13:00:00Z',
      },
      { fetcher, headers: KEY },
    ),
});
