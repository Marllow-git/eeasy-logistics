// platformReplayDeadOutbox (PLAT-8). No platform sign-in exists before PLAT-11, so the scenario
// checks the unauthenticated answer against the contract's error shape; PLAT-11 turns it into a
// signed-in bulk replay.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformReplayDeadOutbox(
      { kind: 'internal_event', reason: 'Contract scenario' },
      {
        fetcher,
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000000002',
          'X-EL-Client': 'web',
          'X-Support-Reason': 'Contract scenario',
        },
      },
    ),
});
