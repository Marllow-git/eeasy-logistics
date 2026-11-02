// driverVerifyOtp (DEL-4 item F): a code no one sent is otp_invalid, the one body of every refusal.
// Signed-in scenarios need a seeded driver and a WhatsApp code, which the
// contract run has no fixture for (plan 8.3); the HTTP suites of apps/api cover them.
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.driverVerifyOtp(
      {
        phone: '+966550000041',
        code: '000000',
        device: { device_id: 'contract-device', platform: 'android', app_version: '1.0.0' },
      },
      { fetcher },
    ),
});
