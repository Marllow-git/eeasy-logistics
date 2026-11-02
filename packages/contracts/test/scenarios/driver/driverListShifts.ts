// driverListShifts (DEL-5 item E): without a bearer token the door is unauthenticated (401).
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the contract run has no
// fixture for; the HTTP suites of apps/api (shifts.http) cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) => client.driverListShifts({ limit: 10 }, { fetcher }),
});
