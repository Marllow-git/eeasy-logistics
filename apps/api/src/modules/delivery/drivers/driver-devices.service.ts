import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type {
  AuditSink,
  DriverIdentities,
  ListPage,
  ListPagePlan,
} from '../../kernel/public/index.js';
import { ApiException, keysetSlice } from '../../kernel/public/index.js';
import type { DriverDeviceRow } from './drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from './drivers.repository.js';
import type { AuditFacts } from './drivers.service.js';

// A driver's devices and cash PIN on the staff surface (DEL-4 plan 2.5; identity and tenancy §3.2,
// §4, §9; ADR-0034). The account is the token's; another account's driver or device is `404`.
// Every write takes the account's driver write lock (8.2 #10) and audits in the tenant
// transaction; a device's refresh families end on the platform pool first (PLAT-12 8.2 #29).

export class DriverDevicesService {
  readonly #logger = new Logger('DriverDevices');

  constructor(
    private readonly deps: {
      readonly identities: DriverIdentities;
      readonly audit: AuditSink;
    },
  ) {}

  /**
   * `listDriverDevices`: the driver's devices, revoked included, newest first, paged in memory over
   * a list two active devices and their revoked predecessors keep short.
   */
  async list(
    driverId: string,
    plan: ListPagePlan<'created_at'>,
  ): Promise<ListPage<DriverDeviceRow>> {
    const uow = getUnitOfWork();
    if ((await new DriversRepository(uow).find(driverId)) === undefined) {
      throw new ApiException('not_found');
    }
    const rows = await new DriverDevicesRepository(uow).ofDriver(driverId);
    const keyOf = (row: DriverDeviceRow) => ({ value: row.createdAt.toISOString(), id: row.id });
    return plan.page(keysetSlice(plan, rows, keyOf), keyOf);
  }

  /**
   * `revokeDriverDevice` (plan 2.5): the device row (`device_id` in the path is its `id`) of a
   * driver of the account; a revoked one is `409 invalid_transition`. The device's driver refresh
   * families end (`revokeAll` scoped to the membership and the device row), then `revoked_at` is set
   * and the push token cleared, audited `delivery.driver_device.revoked`. Access ends within one
   * access-token lifetime (identity §9).
   */
  async revoke(driverId: string, deviceId: string, facts: AuditFacts): Promise<DriverDeviceRow> {
    const uow = getUnitOfWork();
    const drivers = new DriversRepository(uow);
    await drivers.lockWrites();
    await drivers.lockDriver(driverId);
    const driver = await drivers.find(driverId);
    if (driver === undefined) throw new ApiException('not_found');
    const devices = new DriverDevicesRepository(uow);
    const device = await devices.find(driverId, deviceId);
    if (device === undefined) throw new ApiException('not_found');
    if (device.revokedAt !== null) {
      throw new ApiException('invalid_transition', {
        details: { current_status: 'revoked', version: device.version },
      });
    }
    const families = await this.deps.identities.endSessions(driver.userId, driver.membershipId, {
      deviceId: device.id,
      bumpTokenVersion: false,
    });
    const row = await devices.revoke(device.id);
    await this.record({
      targetType: 'driver_device',
      targetId: row.id,
      action: 'delivery.driver_device.revoked',
      before: { revoked: false },
      after: {
        revoked: true,
        driver_id: driver.id,
        platform: row.platform,
        families_ended: families,
      },
      facts,
    });
    this.#logger.log(`driver device revoked driver_id=${driver.id} device=${row.id}`);
    return row;
  }

  /**
   * `resetDriverCashPin` (plan 2.5): the PIN hash, the failure count and the lock cleared,
   * `token_version` unchanged, audited `delivery.driver.cash_pin_reset` (whether a PIN was set and
   * locked, never the hash). The driver sets a new PIN with a fresh code (2.9, leg 2).
   */
  async resetCashPin(driverId: string, facts: AuditFacts): Promise<void> {
    const drivers = new DriversRepository(getUnitOfWork());
    await drivers.lockWrites();
    await drivers.lockDriver(driverId);
    const driver = await drivers.find(driverId);
    if (driver === undefined) throw new ApiException('not_found');
    await drivers.resetCashPin(driver.id);
    await this.record({
      targetType: 'driver',
      targetId: driver.id,
      action: 'delivery.driver.cash_pin_reset',
      // Keys without the token `pin`, which the audit redaction would blank (PLAT-7).
      before: {
        was_set: driver.cashPinHash !== null,
        locked: driver.cashPinLockedAt !== null,
        failures: driver.cashPinFailures,
      },
      after: { was_set: false, locked: false, failures: 0 },
      facts,
    });
    this.#logger.log(`driver cash PIN reset driver_id=${driver.id}`);
  }

  private record(event: {
    readonly targetType: string;
    readonly targetId: string;
    readonly action: string;
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
    readonly facts: AuditFacts;
  }): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: event.targetType,
      targetId: event.targetId,
      action: event.action,
      before: event.before,
      after: event.after,
      requestId: event.facts.requestId,
      clientRequestId: event.facts.clientRequestId,
      ip: event.facts.ip,
      userAgent: event.facts.userAgent,
    });
  }
}
