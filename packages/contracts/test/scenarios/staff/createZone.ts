// createZone (DEL-1 item D): without a session the door is unauthenticated (401). Signed-in, forbidden
// and feature-gated scenarios need a seeded account and staff session, which the contract run has
// no fixture for (DEL-4 plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/staff.ts';
import { defineScenario } from '../../contract/scenario.ts';

const KEY = { 'Idempotency-Key': '00000000-0000-4000-8000-000000001421' };

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.createZone(
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
      { fetcher, headers: KEY },
    ),
});
