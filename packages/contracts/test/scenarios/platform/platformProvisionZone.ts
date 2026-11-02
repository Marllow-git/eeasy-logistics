// platformProvisionZone (DEL-1 item D). The contract run has no platform session, so the scenario checks the
// unauthenticated answer against the contract's error shape; the HTTP suites of apps/api cover
// the provisioning door itself.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformProvisionZone(
      '00000000-0000-7000-8000-000000000000',
      {
        name_ar: 'العليا',
        name_en: 'Olaya',
        source: 'drawn',
        boundary: {
          type: 'Polygon',
          coordinates: [
            [
              [46.66, 24.68],
              [46.7, 24.68],
              [46.7, 24.72],
              [46.66, 24.68],
            ],
          ],
        },
      },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000001425',
          'X-EL-Client': 'web',
        },
      },
    ),
});
