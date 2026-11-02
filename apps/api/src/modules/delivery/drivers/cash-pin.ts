import type { AppDatabase, UnitOfWork } from '@eeasy-logistics/db';
import { getContext, getUnitOfWork, withUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink, PasswordHasher, RequestFacts } from '../../kernel/public/index.js';
import { ApiException, CommittedRefusal } from '../../kernel/public/index.js';
import type { DriverRow } from './drivers.repository.js';
import { DriversRepository } from './drivers.repository.js';

// The cash PIN check (DEL-4 plan 2.9; identity and tenancy §3.2; ADR-0034; driver app §5.2): four to
// six digits, an Argon2id hash with PLAT-11's parameters that never leaves the server, five failures
// lock cash actions until a dispatcher resets. `PinCheck` is what `driverVerifyCashPin`, a PIN
// change and DEL-8's handover and replay checks call: the count of a failure must survive the
// request's `403`. A request holds at most one app connection (adversary H-1): `driverVerifyCashPin`
// has no request unit of work (`@NoUnitOfWork()`), so the check opens the only transaction and
// answers after it committed; inside a request's unit of work (the set door, whose idempotency
// reservation needs it) the check runs in that transaction and refuses with a `CommittedRefusal`,
// which commits the count and gives the reservation up.

export const cashPinRules = { pattern: /^[0-9]{4,6}$/, maxFailures: 5 } as const;

/** What one wrong PIN does to the count (plan 2.9): the fifth failure locks. */
export function afterFailure(failures: number): { failures: number; locks: boolean } {
  const next = Math.min(failures + 1, cashPinRules.maxFailures);
  return { failures: next, locks: next >= cashPinRules.maxFailures };
}

export type AuditFacts = Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>;

type CheckOutcome = 'ok' | 'invalid' | 'locked';

/** The current request's or job's unit of work, or undefined outside one. */
function currentUnitOfWork(): UnitOfWork | undefined {
  try {
    return getUnitOfWork();
  } catch {
    return undefined;
  }
}

export class PinCheck {
  readonly #logger = new Logger('CashPin');

  constructor(
    private readonly deps: {
      /** Null without `DATABASE_URL_APP`: every check answers 500. */
      readonly app: AppDatabase | null;
      readonly hasher: Pick<PasswordHasher, 'hash' | 'verify' | 'dummyHash'>;
      readonly audit: Pick<AuditSink, 'record'>;
    },
  ) {}

  /** The stored form of a new PIN (Argon2id, PLAT-11's parameters). */
  hash(pin: string): Promise<string> {
    if (!cashPinRules.pattern.test(pin)) throw new ApiException('cash_pin_invalid');
    return this.deps.hasher.hash(pin);
  }

  /**
   * Checks `pin` for the driver `driverOf` names (read in the check's transaction), under the
   * driver row lock (the caller must not hold that lock): a locked driver is `423
   * cash_pin_locked`; a driver without a PIN, or a wrong PIN, is `403 cash_pin_invalid` with the
   * same body (a wrong PIN counts one failure, the fifth locks and is audited
   * `delivery.driver.cash_pin_locked`); a right PIN clears the failures. Every answer costs one
   * Argon2id verification. Never logs the PIN. Opens a transaction only when none is current, so
   * it never waits for a second app connection while holding one.
   */
  async check(
    driverOf: () => Promise<DriverRow>,
    pin: string,
    facts: AuditFacts,
  ): Promise<void> {
    const run = async () => this.#check((await driverOf()).id, pin, facts);
    if (currentUnitOfWork() !== undefined) {
      const outcome = await run();
      if (outcome === 'locked') throw new CommittedRefusal('cash_pin_locked');
      if (outcome === 'invalid') throw new CommittedRefusal('cash_pin_invalid');
      return;
    }
    const app = this.deps.app;
    if (app === null) throw new ApiException('internal_error');
    const outcome = await withUnitOfWork(app, getContext(), run);
    if (outcome === 'locked') throw new ApiException('cash_pin_locked');
    if (outcome === 'invalid') throw new ApiException('cash_pin_invalid');
  }

  async #check(driverId: string, pin: string, facts: AuditFacts): Promise<CheckOutcome> {
    const drivers = new DriversRepository(getUnitOfWork());
    await drivers.lockDriver(driverId);
    const driver = await drivers.find(driverId);
    if (driver === undefined) throw new ApiException('not_found');
    const stored = driver.cashPinHash;
    const locked = driver.cashPinLockedAt !== null;
    // The same cost whatever the state: a locked driver or one without a PIN verifies the dummy.
    const usable = stored !== null && !locked && cashPinRules.pattern.test(pin);
    const { ok } = await this.deps.hasher.verify(pin, usable ? stored : this.deps.hasher.dummyHash);
    if (locked) return 'locked';
    if (stored === null) return 'invalid';
    if (usable && ok) {
      if (driver.cashPinFailures > 0) await drivers.recordPinCheck(driver.id, 0, false);
      return 'ok';
    }
    const next = afterFailure(driver.cashPinFailures);
    await drivers.recordPinCheck(driver.id, next.failures, next.locks);
    if (next.locks) {
      const context = getContext();
      await this.deps.audit.record({
        actorType: 'user',
        actorId: context.userId,
        accountId: context.accountId,
        targetType: 'driver',
        targetId: driver.id,
        action: 'delivery.driver.cash_pin_locked',
        before: { locked: false, failures: driver.cashPinFailures },
        after: { locked: true, failures: next.failures },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      this.#logger.warn(`driver cash PIN locked driver_id=${driver.id}`);
    }
    return 'invalid';
  }
}
