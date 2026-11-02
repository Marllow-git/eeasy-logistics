// platformRedeemEnrolmentLink (PLAT-13 adversary M-2): an unknown link is token_invalid. A real link
// needs a TOTP-enrolled super admin's reset and the mail, which the contract run has no fixture for;
// the HTTP suites of apps/api cover the redemption.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.platformRedeemEnrolmentLink(
      {
        token: '00000000-0000-7000-8000-000000000000.' + 'a'.repeat(43),
        password: 'not the password',
      },
      { fetcher },
    ),
});
