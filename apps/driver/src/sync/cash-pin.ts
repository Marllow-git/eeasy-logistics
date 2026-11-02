import { client } from '@eeasy-logistics/contracts/driver';
import { ApiError, uuidv7 } from '@eeasy-logistics/contracts/http';
import { driverApp } from './driver-app';
import { requestOtp } from './sign-in';

// The cash PIN doors (driver app §5.2, §5.3; ADR-0034; DRV-1 plan 2.6). A PIN the server accepts
// arms the device verifier; a server lock wipes it. The PIN is a parameter here and goes nowhere but
// the request body and the Argon2 call.

/** A fresh `Idempotency-Key` (UUID v7); the screen keeps it for a retry of the same submission. */
export function newIdempotencyKey(): string {
  return uuidv7();
}

/** Sends a fresh OTP to the signed-in phone for the first PIN set. */
export async function requestPinOtp(locale: 'ar' | 'en'): Promise<void> {
  const { phone } = driverApp().setup.get();
  if (phone === undefined) throw new Error('No phone is known for this session.');
  await requestOtp(phone, locale);
}

/** First set (`otp_code`) or change (`current_pin`); arms the verifier from the accepted PIN. */
export async function setCashPin(
  body: { pin: string; otp_code?: string; current_pin?: string },
  idempotencyKey: string,
): Promise<void> {
  const app = driverApp();
  await client.driverSetCashPin(body, {
    fetcher: app.fetcher,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  await app.verifier.arm(body.pin);
  app.setup.set({ cashPinSet: true, cashPinLocked: false, verifierArmed: true });
}

export type ArmResult = 'armed' | 'invalid' | 'locked';

/** `driverVerifyCashPin` when a PIN exists and this phone has no verifier (ADR-0034). */
export async function armVerifier(pin: string): Promise<ArmResult> {
  const app = driverApp();
  try {
    await client.driverVerifyCashPin({ cash_pin: pin }, { fetcher: app.fetcher });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'cash_pin_invalid') return 'invalid';
    if (error instanceof ApiError && error.code === 'cash_pin_locked') {
      // A server lock wipes the verifier; the gate moves on once the driver read the notice.
      await app.verifier.wipe();
      app.setup.set({ verifierArmed: false });
      return 'locked';
    }
    throw error;
  }
  await app.verifier.arm(pin);
  app.setup.set({ cashPinLocked: false, verifierArmed: true });
  return 'armed';
}

/** "Continue without cash" after the locked notice: deliveries without cash stay possible (§5.2). */
export function continueWithoutCash(): void {
  driverApp().setup.set({ cashPinLocked: true });
}
