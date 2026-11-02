// platformProvisionCoverage (DEL-1 item D). The contract run has no platform session, so the scenario checks the
// unauthenticated answer against the contract's error shape; the HTTP suites of apps/api cover
// the provisioning door itself.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformProvisionCoverage(
      '00000000-0000-7000-8000-000000000000',
      { entries: [{ site_id: '00000000-0000-7000-8000-000000000000', zone_ids: [] }] },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000001426',
          'X-EL-Client': 'web',
        },
      },
    ),
});
