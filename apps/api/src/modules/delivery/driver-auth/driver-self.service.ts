import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import type {
  DriverIdentities,
  DriverPerson,
  DriverSignIn,
  RequestFacts,
} from '../../kernel/public/index.js';
import { ApiException } from '../../kernel/public/index.js';
import type { DriverDeviceRow, DriverRow } from '../drivers/drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from '../drivers/drivers.repository.js';
import { tokenDriver } from '../drivers/token-driver.js';
import type { MinAppVersions } from './app-version.guard.js';
import { pushTokenProblem } from './device-input.js';

// The signed-in driver's own doors (DEL-4 plan 2.8; identity and tenancy §4): the account, the
// membership and the device are the token's (`getContext()`), nothing else is read from the request.

/** What `driverGetMe` answers before presentation. */
export interface DriverSelf {
  readonly driver: DriverRow;
  readonly person: DriverPerson;
  readonly device: DriverDeviceRow;
  readonly proofPolicy: Readonly<Record<string, unknown>>;
  readonly minAppVersion: MinAppVersions;
}

export class DriverSelfService {
  constructor(
    private readonly deps: {
      readonly signIn: DriverSignIn;
      readonly identities: DriverIdentities;
      readonly minAppVersion: MinAppVersions;
    },
  ) {}

  /**
   * `driverGetMe` (plan 2.8): the token's driver, this device, the account's proof policy and the
   * minimum app versions. The current shift and the cash figures are DEL-5's and DEL-8's.
   */
  async me(): Promise<DriverSelf> {
    const { driver, device } = await this.current();
    // One platform connection at a time (PLAT-12 8.2 #20).
    const people = await this.deps.identities.people([driver.userId]);
    const account = await this.deps.identities.account();
    const person = people.get(driver.userId);
    if (person === undefined) throw new Error('A driver person has no row');
    return {
      driver,
      person,
      device,
      proofPolicy: account.proofPolicy,
      minAppVersion: this.deps.minAppVersion,
    };
  }

  /**
   * `driverUpdatePushToken` (plan 2.8): this device's token replaced under the driver row lock; a
   * revoked device is `401 device_revoked` (its token stays cleared, data §10).
   */
  async updatePushToken(pushToken: string): Promise<DriverDeviceRow> {
    const problem = pushTokenProblem(pushToken);
    if (problem !== undefined) throw new ApiException('validation_failed', { fields: [problem] });
    const uow = getUnitOfWork();
    const { driver } = await this.current();
    await new DriversRepository(uow).lockDriver(driver.id);
    const devices = new DriverDevicesRepository(uow);
    const device = await devices.find(driver.id, this.deviceId());
    if (device === undefined || device.revokedAt !== null) {
      throw new ApiException('device_revoked');
    }
    return devices.setPushToken(device.id, pushToken);
  }

  /**
   * `driverLogout` (plan 2.8): the refresh families of this device end on the platform pool, then
   * the device's `last_seen_at` is marked. Always `204`.
   */
  async logout(facts: RequestFacts): Promise<void> {
    const context = getContext();
    if (context.userId === null || context.membershipId === null) {
      throw new ApiException('unauthenticated');
    }
    await this.deps.signIn.logout(
      {
        userId: context.userId,
        accountId: context.accountId,
        membershipId: context.membershipId,
        deviceId: this.deviceId(),
      },
      facts,
    );
    await new DriverDevicesRepository(getUnitOfWork()).seen(this.deviceId());
  }

  private deviceId(): string {
    const deviceId = getContext().deviceId;
    if (deviceId === null) throw new ApiException('unauthenticated');
    return deviceId;
  }

  /**
   * The token's driver and device (another account's never matches): no driver is `404`, one not
   * `active` `401 token_invalid`, a revoked or vanished device `401 device_revoked` (adversary M-2).
   */
  private current(): Promise<{ driver: DriverRow; device: DriverDeviceRow }> {
    return tokenDriver(getUnitOfWork());
  }
}
