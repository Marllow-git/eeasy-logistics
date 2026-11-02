// platformUpdateAccount (PLAT-13). The contract run has no platform session, so the scenario checks
// the unauthenticated answer against the contract's error shape.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformUpdateAccount(
      '00000000-0000-7000-8000-000000000000',
      { name: 'Contract scenario', limits: { sites: 2 } },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000000014',
          'X-EL-Client': 'web',
          'X-Support-Reason': 'Contract scenario',
        },
      },
    ),
});
