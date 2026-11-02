// platformCloseAccount (PLAT-13 leg 2). The contract run has no platform session, so the scenario
// checks the unauthenticated answer against the contract's error shape; signed in, the door takes
// the body's reason and closes only a suspended account.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformCloseAccount(
      '00000000-0000-7000-8000-000000000000',
      { reason: 'Contract scenario' },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000000020',
          'X-EL-Client': 'web',
        },
      },
    ),
});
