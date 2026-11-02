// platformGetAccount (PLAT-13). The contract run has no platform session, so the scenario checks
// the unauthenticated answer against the contract's error shape; signed in, it reads through the
// cross-tenant door (`X-Support-Reason`).
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformGetAccount('00000000-0000-7000-8000-000000000000', {
      fetcher,
      headers: { 'X-Support-Reason': 'Contract scenario' },
    }),
});
