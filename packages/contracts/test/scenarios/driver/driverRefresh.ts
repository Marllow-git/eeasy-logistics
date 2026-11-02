// driverRefresh (DEL-4 item F): a refresh token this API never issued is token_invalid.
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the
// contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.driverRefresh(
      { refresh_token: 'not-a-refresh-token', device_id: 'contract-device' },
      { fetcher },
    ),
});
