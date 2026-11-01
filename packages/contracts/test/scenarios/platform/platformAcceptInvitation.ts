// platformAcceptInvitation (PLAT-11 item I): an unknown invitation token is token_invalid. Signed-in scenarios need a seeded user and the second factor,
// which the contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformAcceptInvitation(
      { token: 'a'.repeat(43), name: 'Contract', password: 'contract horse battery staple' },
      { fetcher },
    ),
});
