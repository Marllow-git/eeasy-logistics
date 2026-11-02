import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink, DriverSignIn } from '../../kernel/public/index.js';
import { ApiException } from '../../kernel/public/index.js';
import type { AuditFacts, PinCheck } from './cash-pin.js';
import type { DriverRow } from './drivers.repository.js';
import { DriversRepository } from './drivers.repository.js';

// The driver's own cash PIN doors (DEL-4 plan 2.9, 2.12; ADR-0034): the driver is the token's.
// Each call charges `driver_pin_ip`; the five-failure lock bounds each driver.

export class DriverCashPinService {
  readonly #logger = new Logger('DriverCashPin');

  constructor(
    private readonly deps: {
      readonly signIn: DriverSignIn;
      readonly pins: PinCheck;
      readonly audit: AuditSink;
    },
  ) {}

  /**
   * `driverSetCashPin` (plan 2.9): a locked driver is `423`; the first PIN, or the first after a
   * dispatcher's reset, needs a fresh code for the driver's phone (`401 otp_invalid`); a change
   * needs the current PIN (`403 cash_pin_invalid`, counted by `PinCheck`). The new PIN's Argon2id
   * hash is stored under the driver row lock, the failures cleared, audited
   * `delivery.driver.cash_pin_set` (whether one was set and how, never the PIN).
   */
  async set(
    body: { readonly pin: string; readonly current_pin?: string; readonly otp_code?: string },
    facts: AuditFacts,
  ): Promise<void> {
    await this.deps.signIn.chargeCashPin(facts);
    const driver = await this.current();
    if (driver.cashPinLockedAt !== null) throw new ApiException('cash_pin_locked');
    const wasSet = driver.cashPinHash !== null;
    if (wasSet) {
      if (body.current_pin === undefined) throw new ApiException('cash_pin_invalid');
      await this.deps.pins.check(() => Promise.resolve(driver), body.current_pin, facts);
    } else {
      if (body.otp_code === undefined) throw new ApiException('otp_invalid');
      await this.deps.signIn.verifyOwnCode(driver.userId, body.otp_code);
    }
    const hash = await this.deps.pins.hash(body.pin);
    const drivers = new DriversRepository(getUnitOfWork());
    await drivers.lockDriver(driver.id);
    const locked = await drivers.find(driver.id);
    // A dispatcher may have reset (or a check locked) it between the proof and this write.
    if (locked === undefined || locked.cashPinLockedAt !== null) {
      throw new ApiException('cash_pin_locked');
    }
    if ((locked.cashPinHash !== null) !== wasSet) throw new ApiException('cash_pin_invalid');
    const row = await drivers.setCashPin(driver.id, hash);
    const context = getContext();
    await this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'driver',
      targetId: row.id,
      action: 'delivery.driver.cash_pin_set',
      // Keys without the token `pin`, which the audit redaction would blank (PLAT-7).
      before: { was_set: wasSet, failures: driver.cashPinFailures },
      after: { was_set: true, failures: 0, method: wasSet ? 'current' : 'otp' },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    this.#logger.log(`driver cash PIN set driver_id=${row.id}`);
  }

  /**
   * `driverVerifyCashPin` (plan 2.9; ADR-0034): `204`, or `403`/`423` after the count committed.
   * The door has no request unit of work (`@NoUnitOfWork()`, adversary H-1): the driver is read in
   * the check's own, only, transaction.
   */
  async verify(pin: string, facts: AuditFacts): Promise<void> {
    await this.deps.signIn.chargeCashPin(facts);
    await this.deps.pins.check(() => this.current(), pin, facts);
  }

  /** The token's driver (another account's never matches); none is `404`. */
  private async current(): Promise<DriverRow> {
    const membershipId = getContext().membershipId;
    if (membershipId === null) throw new ApiException('unauthenticated');
    const driver = await new DriversRepository(getUnitOfWork()).findOfMembership(membershipId);
    if (driver === undefined) throw new ApiException('not_found');
    return driver;
  }
}
