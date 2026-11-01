// platformListAccountAudit (PLAT-7). No platform sign-in exists before PLAT-11, so the scenario
// checks the unauthenticated answer against the contract's error shape; PLAT-11 turns it into a
// signed-in 200 through the cross-tenant door.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformListAccountAudit(
      '00000000-0000-7000-8000-000000000000',
      { limit: 10 },
      { fetcher, headers: { 'X-Support-Reason': 'Contract scenario' } },
    ),
});
