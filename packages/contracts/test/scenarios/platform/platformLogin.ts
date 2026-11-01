// platformLogin (PLAT-11 item I): an unknown email is invalid_credentials. Signed-in scenarios need a seeded user and the second factor,
// which the contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformLogin(
      { email: 'nobody@example.test', password: 'not the password' },
      { fetcher },
    ),
});
