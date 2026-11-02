import { getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type {
  AuditSink,
  DriverIdentities,
  DriverSignIn,
  IssuedSession,
  RequestFacts,
  SignedInDriver,
} from '../../kernel/public/index.js';
import { ApiException, maxActiveDevices } from '../../kernel/public/index.js';
import type { DriverDeviceRow, DriverRow } from '../drivers/drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from '../drivers/drivers.repository.js';
import type { Driver } from '../drivers/drivers.service.js';
import type { DeviceInput } from './device-input.js';
import { deviceProblems } from './device-input.js';

// The driver's own sign-in (DEL-4 plan 2.7, 2.12; identity and tenancy §3.2, §4; driver app §7.1):
// the kernel checks the code and issues the tokens (`DriverSignIn`), Delivery binds the device. The
// device is bound in the driver's account under the driver row lock, at most two active devices
// (Q-8), before the session is started on that device row; one body (`otp_invalid`) for every
// refusal of the code or the driver, and logs carry the driver and device ids only.

/** What `driverVerifyOtp` answers (`DriverSession`). */
export interface DriverSessionStarted {
  readonly session: IssuedSession;
  readonly driver: Driver;
  readonly device: DriverDeviceRow;
  readonly cashPinSet: boolean;
}

export class DriverSessionsService {
  readonly #logger = new Logger('DriverSessions');

  constructor(
    private readonly deps: {
      readonly signIn: DriverSignIn;
      readonly identities: DriverIdentities;
      readonly audit: AuditSink;
    },
  ) {}

  /**
   * `driverVerifyOtp` (plan 2.7): the device's fields checked (`400`), the code and the driver
   * (`401 otp_invalid`; `409 account_choice_required` when the phone drives for several accounts
   * and the body names none, adversary H-2), the device bound in the driver's account (`409 device_limit_reached`), then
   * the session on the device row.
   */
  async signIn(
    input: {
      readonly phone: string;
      readonly code: string;
      readonly device: DeviceInput;
      /** The account chosen after `409 account_choice_required` (adversary H-2). */
      readonly account_id?: string | undefined;
    },
    facts: RequestFacts,
  ): Promise<DriverSessionStarted> {
    const problems = deviceProblems(input.device);
    if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
    const { phone, code, account_id: accountId } = input;
    const signedIn = await this.deps.signIn.verifyCode(
      accountId === undefined ? { phone, code } : { phone, code, accountId },
      facts,
    );
    const bound = await this.deps.signIn.inAccount(signedIn, facts.requestId, () =>
      this.bind(signedIn, input.device, facts),
    );
    const session = await this.deps.signIn.start(signedIn, bound.device.id, facts);
    // A dispatcher may suspend the driver or revoke the device between the bind and the session
    // (adversary M-2): both are read again; if either changed, the family just started ends.
    const refusal = await this.deps.signIn.inAccount(signedIn, facts.requestId, async () => {
      const uow = getUnitOfWork();
      const driver = await new DriversRepository(uow).find(signedIn.driverId);
      if (driver?.status !== 'active') return 'otp_invalid' as const;
      const device = await new DriverDevicesRepository(uow).find(driver.id, bound.device.id);
      return device === undefined || device.revokedAt !== null
        ? ('device_revoked' as const)
        : undefined;
    });
    if (refusal !== undefined) {
      await this.deps.signIn.abandon(signedIn, bound.device.id);
      this.#logger.log(`driver sign-in withdrawn: ${refusal} driver_id=${signedIn.driverId}`);
      throw new ApiException(refusal);
    }
    const people = await this.deps.identities.people([signedIn.userId]);
    const person = people.get(signedIn.userId);
    if (person === undefined) throw new Error('The person of a signed-in driver has no row');
    this.#logger.log(`driver signed in driver_id=${bound.driver.id} device_id=${bound.device.id}`);
    return {
      session,
      driver: { row: bound.driver, person },
      device: bound.device,
      cashPinSet: bound.driver.cashPinHash !== null,
    };
  }

  /**
   * The device of a sign-in (plan 2.7), in the driver's account under the driver row lock: the
   * driver still `active` (else `otp_invalid`, as at the code check), the device found by the app's
   * id or created, a revoked row of that id refused (`401 device_revoked`, adversary M-1), and at
   * most `maxActiveDevices` active devices counting this one. A new device row is audited
   * `delivery.driver_device.registered`.
   */
  private async bind(
    signedIn: SignedInDriver,
    input: DeviceInput,
    facts: RequestFacts,
  ): Promise<{ driver: DriverRow; device: DriverDeviceRow }> {
    const uow = getUnitOfWork();
    const drivers = new DriversRepository(uow);
    await drivers.lockDriver(signedIn.driverId);
    const driver = await drivers.find(signedIn.driverId);
    if (driver === undefined || driver.status !== 'active') {
      throw new ApiException('otp_invalid');
    }
    const devices = new DriverDevicesRepository(uow);
    const known = await devices.findByAppId(driver.id, input.device_id);
    // A dispatcher's revocation is final for that app id (adversary M-1): a code never brings it
    // back; a lost phone means suspending the driver (8.2 #39).
    if (known !== undefined && known.revokedAt !== null) {
      this.#logger.log(
        `driver device refused: revoked driver_id=${driver.id} device_id=${known.id}`,
      );
      throw new ApiException('device_revoked');
    }
    const others = (await devices.active(driver.id)).filter((device) => device.id !== known?.id);
    if (others.length >= maxActiveDevices) {
      this.#logger.log(`driver device refused: limit reached driver_id=${driver.id}`);
      throw new ApiException('device_limit_reached');
    }
    const fields = {
      platform: input.platform,
      appVersion: input.app_version,
      pushToken: input.push_token,
    };
    const device =
      known === undefined
        ? await devices.insert({
            id: uuidv7(),
            driverId: driver.id,
            deviceId: input.device_id,
            ...fields,
            pushToken: input.push_token ?? null,
          })
        : await devices.rebind(known.id, fields);
    if (known === undefined) {
      await this.deps.audit.record({
        actorType: 'user',
        actorId: signedIn.userId,
        accountId: signedIn.accountId,
        targetType: 'driver_device',
        targetId: device.id,
        action: 'delivery.driver_device.registered',
        after: {
          driver_id: driver.id,
          platform: device.platform,
          app_version: device.appVersion,
        },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
    }
    return { driver, device };
  }
}
