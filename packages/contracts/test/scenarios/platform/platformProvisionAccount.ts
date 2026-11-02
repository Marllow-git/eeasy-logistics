// platformProvisionAccount (PLAT-13). The contract run has no platform session, so the scenario
// checks the unauthenticated answer against the contract's error shape.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformProvisionAccount(
      {
        name: 'Contract scenario',
        default_locale: 'ar',
        limits: { orders_per_month: 100, drivers: 2, sites: 1, api_keys: 0 },
        modules: ['delivery'],
        owner: { email: 'owner@example.test', name: 'Owner' },
      },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000000013',
          'X-EL-Client': 'web',
        },
      },
    ),
});
