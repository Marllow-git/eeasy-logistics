import type { DriverRefreshRequest, TokenPair } from '@eeasy-logistics/contracts/driver';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { secretKeys } from '../src/platform/secure-store';
import { leaseMilliseconds, sqliteRefreshLease } from '../src/sync/refresh-lease';
import { Session, type SessionDeps } from '../src/sync/session';
import { fakeClock, memorySecrets, sharedDatabase } from './helpers';

// The single-flight refresh of driver app §7.2 (DRV-1 plan 2.4, 2.11): one call per JS context, one
// token presentation across contexts through the SQLite lease, and the answers that end a session.

function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code: code as never, message: code, headers: new Headers() });
}

/** The server side of `driverRefresh`: rotation, and a reused token revokes the family. */
function refreshServer() {
  let valid = 'refresh-0';
  let rotations = 0;
  let familyRevoked = false;
  const presented: string[] = [];
  return {
    presented,
    get familyRevoked() {
      return familyRevoked;
    },
    refresh: async (body: DriverRefreshRequest): Promise<TokenPair> => {
      presented.push(body.refresh_token);
      // A few turns of the event loop, so concurrent callers overlap while one is in flight.
      for (let turn = 0; turn < 3; turn += 1)
        await new Promise<void>((resolve) => setImmediate(() => resolve()));
      if (familyRevoked || body.refresh_token !== valid) {
        familyRevoked = true;
        throw apiError(401, 'token_invalid');
      }
      rotations += 1;
      valid = `refresh-${rotations}`;
      return { access_token: `access-${rotations}`, refresh_token: valid, expires_in: 900 };
    },
  };
}

async function signedInSecrets() {
  const secrets = memorySecrets();
  await secrets.set(secretKeys.refreshToken, 'refresh-0');
  await secrets.set(secretKeys.deviceId, 'device-1');
  await secrets.set(secretKeys.driverId, 'driver-1');
  return secrets;
}

describe('session refresh', () => {
  const database = sharedDatabase();
  afterAll(() => database.close());

  function session(overrides: Partial<SessionDeps> & Pick<SessionDeps, 'secrets' | 'refresh'>) {
    const clock = fakeClock();
    return new Session({
      lease: sqliteRefreshLease(database.connect()),
      holder: `holder-${Math.random()}`,
      now: clock.now,
      sleep: clock.sleep,
      ...overrides,
    });
  }

  it('shares one call between concurrent callers of one context', async () => {
    const server = refreshServer();
    const subject = session({ secrets: await signedInSecrets(), refresh: server.refresh });
    await subject.hydrate();

    const tokens = await Promise.all(Array.from({ length: 5 }, () => subject.getAccessToken()));

    expect(tokens).toEqual(Array(5).fill('access-1'));
    expect(server.presented).toEqual(['refresh-0']);
  });

  it('presents each token once across two contexts sharing the lease', async () => {
    const server = refreshServer();
    const secrets = await signedInSecrets(); // the keychain is shared by both contexts
    const clock = fakeClock();
    const foreground = new Session({
      secrets,
      refresh: server.refresh,
      lease: sqliteRefreshLease(database.connect()),
      holder: 'foreground',
      now: clock.now,
      sleep: clock.sleep,
    });
    const background = new Session({
      secrets,
      refresh: server.refresh,
      lease: sqliteRefreshLease(database.connect()),
      holder: 'background',
      now: clock.now,
      sleep: clock.sleep,
    });
    await Promise.all([foreground.hydrate(), background.hydrate()]);

    const [a, b] = await Promise.all([foreground.refresh(), background.refresh()]);

    expect(server.presented).toEqual(['refresh-0', 'refresh-1']);
    expect(server.familyRevoked).toBe(false);
    expect(new Set([a, b])).toEqual(new Set(['access-1', 'access-2']));
    expect(secrets.values.get(secretKeys.refreshToken)).toBe('refresh-2');
  });

  it('without the lease, the same race revokes the family (the failure the lease prevents)', async () => {
    const server = refreshServer();
    const secrets = await signedInSecrets();
    const noLease = { tryAcquire: () => true, release: () => undefined };
    const one = session({ secrets, refresh: server.refresh, lease: noLease });
    const two = session({ secrets, refresh: server.refresh, lease: noLease });
    await Promise.all([one.hydrate(), two.hydrate()]);

    await Promise.allSettled([one.refresh(), two.refresh()]);

    expect(server.presented).toEqual(['refresh-0', 'refresh-0']);
    expect(server.familyRevoked).toBe(true);
  });

  it('takes over a lease whose holder died once it expires', () => {
    const clock = fakeClock();
    const lease = sqliteRefreshLease(database.connect());
    const other = sqliteRefreshLease(database.connect());
    expect(other.tryAcquire('dead-task', clock.now())).toBe(true);
    expect(lease.tryAcquire('app', clock.now())).toBe(false);
    clock.advance(leaseMilliseconds);
    expect(lease.tryAcquire('app', clock.now())).toBe(true);
    lease.release('app');
  });

  it('refreshes 60 s before the access token expires, not earlier', async () => {
    const server = refreshServer();
    const clock = fakeClock();
    const subject = session({
      secrets: await signedInSecrets(),
      refresh: server.refresh,
      now: clock.now,
      sleep: clock.sleep,
    });
    await subject.hydrate();
    await subject.getAccessToken(); // access-1, 900 s
    clock.advance(839_000);
    expect(await subject.getAccessToken()).toBe('access-1');
    clock.advance(2_000);
    expect(await subject.getAccessToken()).toBe('access-2');
  });

  it.each([
    ['device_revoked', 'device_revoked'],
    ['token_invalid', 'token_invalid'],
    ['token_expired', 'token_invalid'],
  ])('ends the session on 401 %s and clears the tokens and the verifier', async (code, reason) => {
    const secrets = await signedInSecrets();
    await secrets.set(secretKeys.pinVerifier, 'verifier');
    const onEnded = jest.fn(() => secrets.delete(secretKeys.pinVerifier));
    const subject = session({
      secrets,
      onEnded,
      refresh: () => Promise.reject(apiError(401, code)),
    });
    await subject.hydrate();

    await expect(subject.refresh()).rejects.toBeInstanceOf(ApiError);

    expect(subject.getState()).toMatchObject({ signedIn: false, endReason: reason });
    expect(onEnded).toHaveBeenCalledWith(reason);
    expect([...secrets.values.keys()]).toEqual([secretKeys.deviceId]);
  });

  it('keeps a suspended account signed in, read-only', async () => {
    const subject = session({
      secrets: await signedInSecrets(),
      refresh: () => Promise.reject(apiError(403, 'account_suspended')),
    });
    await subject.hydrate();

    await expect(subject.refresh()).rejects.toBeInstanceOf(ApiError);

    expect(subject.getState()).toMatchObject({ signedIn: true, suspended: true });
  });

  it('keeps the session when the network fails', async () => {
    const subject = session({
      secrets: await signedInSecrets(),
      refresh: () => Promise.reject(new TypeError('Network request failed')),
    });
    await subject.hydrate();

    await expect(subject.refresh()).rejects.toBeInstanceOf(TypeError);

    expect(subject.getState()).toMatchObject({ signedIn: true, suspended: false });
  });
});
