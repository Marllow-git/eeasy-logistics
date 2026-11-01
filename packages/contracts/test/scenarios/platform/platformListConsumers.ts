// platformListConsumers (PLAT-8). No platform sign-in exists before PLAT-11, so the scenario checks
// the unauthenticated answer against the contract's error shape; PLAT-11 turns it into a signed-in
// 200 with the kernel consumer's counts.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) => client.platformListConsumers({ fetcher }),
});
