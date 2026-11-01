// requestPasswordReset (PLAT-11 item I): every email answers 202 (identity and tenancy §8). Signed-in scenarios need a seeded user and the second factor,
// which the contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 202,
  run: ({ fetcher }) => client.requestPasswordReset({ email: 'nobody@example.test' }, { fetcher }),
});
