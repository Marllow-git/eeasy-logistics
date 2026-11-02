import { client } from '@eeasy-logistics/contracts/driver';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { secretKeys } from '../src/platform/secure-store';
import { createDriverFetcher } from '../src/sync/api';
import { sqliteRefreshLease } from '../src/sync/refresh-lease';
import { Session } from '../src/sync/session';
import { fakeClock, memorySecrets, sharedDatabase } from './helpers';

// The transport (DRV-1 plan 2.4, 2.9, 2.11): the version headers on every request, the anonymous
// and authenticated doors, and the answers that change the session.

interface Call {
  url: string;
  method: string;
  headers: Headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const me = {
  driver: { id: 'driver-1', phone: '+966500000001' },
  cash_pin_set: true,
};

async function setup(answers: ((call: Call) => Response)[]) {
  const database = sharedDatabase();
  const secrets = memorySecrets();
  await secrets.set(secretKeys.refreshToken, 'refresh-0');
  await secrets.set(secretKeys.deviceId, 'device-1');
  const calls: Call[] = [];
  const clock = fakeClock();
  let refreshes = 0;
  const session = new Session({
    secrets,
    lease: sqliteRefreshLease(database.connect()),
    holder: 'test',
    now: clock.now,
    sleep: clock.sleep,
    refresh: () => {
      refreshes += 1;
      return Promise.resolve({
        access_token: `access-${refreshes}`,
        refresh_token: `refresh-${refreshes}`,
        expires_in: 900,
      });
    },
  });
  await session.hydrate();
  let locale: 'ar' | 'en' = 'ar';
  const fetcher = createDriverFetcher({
    baseUrl: 'https://api.test/',
    session,
    locale: () => locale,
    appVersion: '1.2.3',
    platform: 'android',
    requestId: () => 'request-id',
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const call = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers) };
      calls.push(call);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`unexpected call ${call.url}`);
      return Promise.resolve(answer(call));
    },
  });
  return {
    fetcher,
    session,
    calls,
    setLocale: (next: 'ar' | 'en') => {
      locale = next;
    },
    get refreshes() {
      return refreshes;
    },
    close: () => database.close(),
  };
}

describe('the driver fetcher', () => {
  it('sends the version headers and the language on an anonymous door, without a token', async () => {
    const t = await setup([() => new Response(null, { status: 202 })]);
    await client.driverRequestOtp({ phone: '+966500000001' }, { fetcher: t.fetcher });

    const [call] = t.calls;
    expect(call!.url).toBe('https://api.test/v1/driver/auth/otp/request');
    expect(call!.headers.get('x-app-version')).toBe('1.2.3');
    expect(call!.headers.get('x-app-platform')).toBe('android');
    expect(call!.headers.get('accept-language')).toBe('ar');
    expect(call!.headers.get('x-request-id')).toBe('request-id');
    expect(call!.headers.has('authorization')).toBe(false);
    expect(call!.headers.has('x-el-client')).toBe(false);
    t.close();
  });

  it('sends the version headers and the bearer token on an authenticated door', async () => {
    const t = await setup([() => json(200, me)]);
    t.setLocale('en');
    const response = await client.driverGetMe({ fetcher: t.fetcher });

    expect(response.data).toEqual(me);
    const [call] = t.calls;
    expect(call!.headers.get('authorization')).toBe('Bearer access-1');
    expect(call!.headers.get('x-app-version')).toBe('1.2.3');
    expect(call!.headers.get('x-app-platform')).toBe('android');
    expect(call!.headers.get('accept-language')).toBe('en');
    t.close();
  });

  it('refreshes once on 401 token_expired and retries with the same Idempotency-Key', async () => {
    const t = await setup([
      () => json(401, { code: 'token_expired', message: 'expired' }),
      () => json(200, { id: 'device-row' }),
    ]);
    await client.driverUpdatePushToken(
      { push_token: 'ExponentPushToken[x]' },
      { fetcher: t.fetcher, headers: { 'Idempotency-Key': 'key-1' } },
    );

    expect(t.calls).toHaveLength(2);
    expect(t.calls.map((call) => call.headers.get('idempotency-key'))).toEqual(['key-1', 'key-1']);
    expect(t.calls.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
    expect(t.refreshes).toBe(2);
    t.close();
  });

  it('asks for an update on 426 from any door', async () => {
    const t = await setup([() => json(426, { code: 'app_update_required', message: 'update' })]);
    await expect(
      client.driverRequestOtp({ phone: '+966500000001' }, { fetcher: t.fetcher }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(t.session.getState().updateRequired).toBe(true);
    t.close();
  });

  it.each(['device_revoked', 'token_invalid'] as const)(
    'ends the session on 401 %s from an authenticated door',
    async (code) => {
      const t = await setup([() => json(401, { code, message: code })]);
      await expect(client.driverGetMe({ fetcher: t.fetcher })).rejects.toBeInstanceOf(ApiError);
      expect(t.session.getState()).toMatchObject({ signedIn: false, endReason: code });
      t.close();
    },
  );

  it('turns the session read-only on 403 account_suspended', async () => {
    const t = await setup([() => json(403, { code: 'account_suspended', message: 'suspended' })]);
    await expect(client.driverGetMe({ fetcher: t.fetcher })).rejects.toBeInstanceOf(ApiError);
    expect(t.session.getState()).toMatchObject({ signedIn: true, suspended: true });
    t.close();
  });
});
