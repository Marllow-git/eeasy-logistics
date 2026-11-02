import { publicConfig } from '@eeasy-logistics/config/driver';
import { client, type DriverMe, type TokenPair } from '@eeasy-logistics/contracts/driver';
import type { Fetcher, Locale } from '@eeasy-logistics/contracts/http';
import { argon2id } from '../platform/argon2';
import { appDatabase, preferences } from '../platform/database';
import { appPlatform, appVersion, randomBytes, randomUuid } from '../platform/device';
import { secretKeys, secureStore, type SecretStore } from '../platform/secure-store';
import { isOlderThan } from '../domain/version';
import { createDriverFetcher } from './api';
import { PinVerifier } from './pin-verifier';
import { sqliteRefreshLease } from './refresh-lease';
import { Session } from './session';
import { Store } from './store';

// The app's one composition of the sync layer (driver app §2): the session, the transport, the PIN
// verifier and the setup facts the route gate reads. Screens reach the API only through here.

export interface SetupState {
  readonly hydrated: boolean;
  /** `cash_pin_set` from sign-in or `driverGetMe`; undefined until one answered. */
  readonly cashPinSet: boolean | undefined;
  readonly cashPinLocked: boolean;
  readonly verifierArmed: boolean;
  readonly permissionsDone: boolean;
  /** This build is older than `min_app_version` (the soft notice, plan 2.9). */
  readonly softUpdate: boolean;
  /** The signed-in phone, for the OTP of the first PIN set; from sign-in or `driverGetMe`. */
  readonly phone: string | undefined;
}

const permissionsDoneKey = 'setup.permissions_done';

export interface DriverApp {
  readonly session: Session;
  readonly fetcher: Fetcher;
  readonly verifier: PinVerifier;
  readonly setup: Store<SetupState>;
  readonly secrets: SecretStore;
  /** This install's device id (a random UUID kept in the secure store, §7.1). */
  deviceId(): Promise<string>;
  /** Reads the stored session and setup facts once, then `driverGetMe` when signed in. */
  start(): Promise<void>;
  /** `driverGetMe` into the setup facts; offline leaves them as they were. */
  loadMe(): Promise<DriverMe | undefined>;
  setPermissionsDone(): void;
}

let instance: DriverApp | undefined;

/** Builds the app's sync layer once; `locale` is the app language getter. */
export function initDriverApp(locale: () => Locale): DriverApp {
  instance ??= buildDriverApp(locale);
  return instance;
}

export function driverApp(): DriverApp {
  if (instance === undefined) throw new Error('initDriverApp() runs in the root layout first.');
  return instance;
}

function buildDriverApp(locale: () => Locale): DriverApp {
  const config = publicConfig();
  const secrets = secureStore;
  const verifier = new PinVerifier({ secrets, argon2id, randomBytes });
  const setup = new Store<SetupState>({
    hydrated: false,
    cashPinSet: undefined,
    cashPinLocked: false,
    verifierArmed: false,
    permissionsDone: preferences.get(permissionsDoneKey) === 'true',
    softUpdate: false,
    phone: undefined,
  });

  // The session refreshes through the fetcher, which itself reads the session: tie the knot.
  const transport: { fetcher?: Fetcher } = {};
  const session = new Session({
    secrets,
    lease: sqliteRefreshLease(appDatabase()),
    holder: `app-${randomUuid()}`,
    refresh: async (body) => {
      const response = await client.driverRefresh(body, { fetcher: transport.fetcher });
      return response.data as TokenPair;
    },
    onEnded: async () => {
      await verifier.wipe();
      preferences.remove(permissionsDoneKey);
      setup.set({
        cashPinSet: undefined,
        cashPinLocked: false,
        verifierArmed: false,
        permissionsDone: false,
        phone: undefined,
      });
    },
  });
  const boundFetcher = createDriverFetcher({
    baseUrl: config.apiUrl,
    session,
    locale,
    appVersion: appVersion(),
    platform: appPlatform(),
    requestId: randomUuid,
  });
  transport.fetcher = boundFetcher;

  const deviceId = async (): Promise<string> => {
    const stored = await secrets.get(secretKeys.deviceId);
    if (stored !== null) return stored;
    const created = randomUuid();
    await secrets.set(secretKeys.deviceId, created);
    return created;
  };

  const loadMe = async (): Promise<DriverMe | undefined> => {
    let me: DriverMe;
    try {
      me = (await client.driverGetMe({ fetcher: boundFetcher })).data as DriverMe;
    } catch {
      return undefined; // offline, or an answer the fetcher already turned into session state
    }
    const minimum = me.min_app_version?.[appPlatform()];
    const locked = me.driver?.cash_pin_locked === true;
    if (locked) await verifier.wipe(); // a server lock wipes the verifier (ADR-0034)
    setup.set({
      cashPinSet: me.cash_pin_set,
      cashPinLocked: locked,
      verifierArmed: await verifier.isArmed(),
      softUpdate: isOlderThan(appVersion(), minimum),
      phone: me.driver?.phone,
    });
    return me;
  };

  return {
    session,
    fetcher: boundFetcher,
    verifier,
    setup,
    secrets,
    deviceId,
    loadMe,
    async start() {
      await deviceId();
      await session.hydrate();
      setup.set({ verifierArmed: await verifier.isArmed() });
      if (session.getState().signedIn) await loadMe();
      setup.set({ hydrated: true });
    },
    setPermissionsDone() {
      preferences.set(permissionsDoneKey, 'true');
      setup.set({ permissionsDone: true });
    },
  };
}
