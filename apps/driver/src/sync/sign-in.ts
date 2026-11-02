import {
  client,
  type DeviceInfo,
  type DriverSession,
  type OtpVerifyRequest,
} from '@eeasy-logistics/contracts/driver';
import { ApiError, type Locale } from '@eeasy-logistics/contracts/http';
import { appPlatform, appVersion } from '../platform/device';
import { driverApp } from './driver-app';
import { currentPushToken } from './push-token';

// Sign-in and device binding (driver app §7.1, DRV-1 plan 2.5; DEL-4 plan 8.2 #26, #37, #39). The
// pending sign-in (phone, code, the accounts to choose from) lives in memory only, for the account
// picker's retry with the same code; it is cleared when the session starts.

export interface AccountChoice {
  readonly account_id: string;
  readonly name: string;
}

export type VerifyResult =
  | { readonly kind: 'signed_in'; readonly session: DriverSession }
  | { readonly kind: 'choose_account'; readonly accounts: readonly AccountChoice[] };

interface PendingSignIn {
  phone: string;
  code?: string;
  accounts?: readonly AccountChoice[];
}

let pending: PendingSignIn | undefined;

export function pendingSignIn(): Readonly<PendingSignIn> | undefined {
  return pending;
}

/** `driverRequestOtp`: 202 whatever the phone; the screen says so generically. */
export async function requestOtp(phone: string, locale: Locale): Promise<void> {
  await client.driverRequestOtp({ phone, locale }, { fetcher: driverApp().fetcher });
  pending = { phone };
}

async function deviceInfo(): Promise<DeviceInfo> {
  const pushToken = await currentPushToken();
  return {
    device_id: await driverApp().deviceId(),
    platform: appPlatform(),
    app_version: appVersion(),
    ...(pushToken === undefined ? {} : { push_token: pushToken }),
  };
}

function accountsOf(error: ApiError): readonly AccountChoice[] {
  const accounts = error.details?.accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.filter(
    (entry): entry is AccountChoice =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as AccountChoice).account_id === 'string' &&
      typeof (entry as AccountChoice).name === 'string',
  );
}

/**
 * `driverVerifyOtp`. `409 account_choice_required` leaves the code valid for one retry with the
 * chosen `account_id`; every other refusal is thrown as `ApiError` for the screen to show.
 */
export async function verifyOtp(
  phone: string,
  code: string,
  accountId?: string,
): Promise<VerifyResult> {
  const app = driverApp();
  const body: OtpVerifyRequest = {
    phone,
    code,
    device: await deviceInfo(),
    ...(accountId === undefined ? {} : { account_id: accountId }),
  };
  let session: DriverSession;
  try {
    session = (await client.driverVerifyOtp(body, { fetcher: app.fetcher })).data as DriverSession;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'account_choice_required') {
      const accounts = accountsOf(error);
      pending = { phone, code, accounts };
      return { kind: 'choose_account', accounts };
    }
    throw error;
  }
  if (session.tokens === undefined || session.driver?.id === undefined) {
    throw new Error('driverVerifyOtp answered without tokens or a driver.');
  }
  app.setup.set({
    cashPinSet: session.cash_pin_set ?? false,
    phone: session.driver.phone ?? phone,
  });
  await app.session.begin(session.tokens, session.driver.id, accountId);
  pending = undefined;
  return { kind: 'signed_in', session };
}

/** Seconds to wait from a `429` (`details.retry_after_s`, else `Retry-After`), or undefined. */
export function retryAfterSeconds(error: ApiError): number | undefined {
  const fromDetails = error.details?.retry_after_s;
  if (typeof fromDetails === 'number') return Math.ceil(fromDetails);
  const header = Number(error.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined;
}
