// platformListAccountMembers (PLAT-13 leg 2). The contract run has no platform session, so the
// scenario checks the unauthenticated answer against the contract's error shape; signed in, the
// door requires `X-Support-Reason` and leaves one audit row per call.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformListAccountMembers(
      '00000000-0000-7000-8000-000000000000',
      { limit: 10 },
      { fetcher, headers: { 'X-Support-Reason': 'Contract scenario' } },
    ),
});
