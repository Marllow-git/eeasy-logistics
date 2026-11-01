// enrolSecondFactor (PLAT-11 item I): an unknown enrolment token is token_invalid. Signed-in scenarios need a seeded user and the second factor,
// which the contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.enrolSecondFactor(
      {
        enrolment_token: '00000000-0000-7000-8000-000000000000.' + 'a'.repeat(43),
        phone: '+966500000000',
      },
      { fetcher },
    ),
});
