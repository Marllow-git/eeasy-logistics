// cancelOrder (DEL-2 item E): without a session the door is unauthenticated (401). Signed-in, forbidden
// and feature-gated scenarios need a seeded account and staff session, which the contract run has
// no fixture for (DEL-4 plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000002204', 'If-Match': '"1"' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.cancelOrder(
      '00000000-0000-7000-8000-000000000000',
      { reason_code: 'customer_request' },
      { fetcher, headers: KEY },
    ),
});
