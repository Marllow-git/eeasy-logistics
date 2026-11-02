// driverStartShift (DEL-5 item E): without a bearer token the door is unauthenticated (401).
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the contract run has no
// fixture for; the HTTP suites of apps/api (shifts.http) cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

const VEHICLE = '00000000-0000-7000-8000-000000000051';
const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001501' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) => client.driverStartShift({ vehicle_id: VEHICLE }, { fetcher, headers: KEY }),
});
