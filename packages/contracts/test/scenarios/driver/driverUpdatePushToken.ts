// driverUpdatePushToken (DEL-4 item F): without a bearer token the door is unauthenticated.
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the
// contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001407' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.driverUpdatePushToken(
      { push_token: 'ExponentPushToken[contract]' },
      { fetcher, headers: KEY },
    ),
});
