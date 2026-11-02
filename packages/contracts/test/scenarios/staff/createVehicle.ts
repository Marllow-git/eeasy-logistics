// createVehicle (DEL-4 item F): without a session the door is unauthenticated (401). Signed-in and
// forbidden scenarios need a seeded account and staff session, which the contract run has no
// fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001405' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.createVehicle(
      { plate: 'ABC 1234', kind: 'van', capacity_parcels: 40 },
      { fetcher, headers: KEY },
    ),
});
