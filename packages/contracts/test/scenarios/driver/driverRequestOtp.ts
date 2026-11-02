// driverRequestOtp (DEL-4 item F): a phone that is no phone is 400 validation_failed at /body/phone (every
// parseable phone answers 202, known or not, and would spend the run's OTP budgets).
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the
// contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 400,
  run: ({ fetcher }) =>
    client.driverRequestOtp({ phone: 'not a phone', locale: 'en' }, { fetcher }),
});
