import { afterCommit, getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { Locale } from '@eeasy-logistics/i18n/push';
import type {
  AuditSink,
  ListPage,
  ListPagePlan,
  OutboxWriter,
  RequestFacts,
  ShiftStatus,
} from '../../kernel/public/index.js';
import { ApiException, siteSummaries } from '../../kernel/public/index.js';
import type { DriverRow } from '../drivers/drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from '../drivers/drivers.repository.js';
import { tokenDriver } from '../drivers/token-driver.js';
import type { LocationFanout } from '../locations/location-fanout.js';
import { LocationHeadsRepository } from '../locations/locations.repository.js';
import { VehiclesRepository } from '../vehicles/vehicles.repository.js';
import {
  adHocShiftMs,
  ineligibleReason,
  isStale,
  noShowGraceMs,
  overdueGraceMs,
  planWindowProblems,
  staleRepeatMs,
} from './shift-input.js';
import type { ShiftActor } from './shift-machine.js';
import { transition } from './shift-machine.js';
import type { ShiftFilters, ShiftRow, ShiftSortField } from './shifts.repository.js';
import { ShiftsRepository, shiftKeyOf } from './shifts.repository.js';

// The shift doors (DEL-5 plan 2.3, 2.4, 2.9; domain model §3.6, §3.17; ADR-0009). The account is
// always the token's. Every write runs under the driver row lock of DEL-4 (`<account>/
// del_drivers:<id>`), so the one-live-shift rule, the overlap check and each arrow see what the
// previous write committed; the partial unique index is the last guard. Starts and ends write the
// `delivery.shift.started` / `.ended` events (ids and times only, never a position) and an audit
// row; staff writes are audited with the member as actor, the driver's own with the driver.

type AuditFacts = Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>;

export type EndedBy = Extract<ShiftActor, 'driver' | 'dispatcher' | 'system'>;

/**
 * Why the system ended a shift: the account's suspension (plan 2.5), the planned end long passed,
 * or the driver leaving `active` (adversary round 1, finding 1).
 */
export type SystemEndReason =
  'account_suspended' | 'planned_end_passed' | 'driver_suspended' | 'driver_archived';

export interface PlanShiftInput {
  readonly driver_id: string;
  readonly site_id: string;
  readonly vehicle_id?: string | undefined;
  readonly planned_start: string;
  readonly planned_end: string;
}

export class ShiftsService {
  constructor(
    private readonly deps: {
      readonly audit: AuditSink;
      readonly outbox: Pick<OutboxWriter, 'enqueue'>;
      /** The latest-position keys (plan 2.4: an ended shift leaves the maps); none without Redis. */
      readonly fanout?: Pick<LocationFanout, 'forget'> | null;
      /** The clock (tests); the server's otherwise. */
      readonly now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** `listShifts` / `driverListShifts`: one keyset page in SQL. */
  async list(
    plan: ListPagePlan<ShiftSortField>,
    filters: ShiftFilters,
  ): Promise<ListPage<ShiftRow>> {
    const rows = await new ShiftsRepository(getUnitOfWork()).page({
      filters,
      sort: plan.sort,
      after: plan.after,
      limit: plan.limit,
    });
    return plan.page(rows, (row) => shiftKeyOf(plan.sort.field, row));
  }

  /** `getShift`: another account's shift is `404`. */
  async get(id: string): Promise<ShiftRow> {
    const row = await new ShiftsRepository(getUnitOfWork()).find(id);
    if (row === undefined) throw new ApiException('not_found');
    return row;
  }

  /**
   * `planShift` (plan 2.3): the driver `active`, the site an `active` branch (or `both`), the
   * vehicle `active` when named, the window, no overlap with the driver's open shifts.
   */
  async plan(input: PlanShiftInput, facts: AuditFacts): Promise<ShiftRow> {
    const start = new Date(input.planned_start);
    const end = new Date(input.planned_end);
    const problems = planWindowProblems(start, end, this.now());
    if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });

    const uow = getUnitOfWork();
    const drivers = new DriversRepository(uow);
    const driver = await drivers.find(input.driver_id);
    if (driver === undefined) throw unknownReference('/body/driver_id');
    await drivers.lockDriver(driver.id);
    const locked = await drivers.find(driver.id);
    if (locked === undefined) throw unknownReference('/body/driver_id');
    if (locked.status !== 'active') {
      throw new ApiException('driver_not_eligible', { details: { reason: 'driver_suspended' } });
    }
    const [site] = await siteSummaries(uow, [input.site_id]);
    if (site === undefined) throw unknownReference('/body/site_id');
    if (site.kind === 'warehouse') throw new ApiException('site_kind_mismatch');
    if (site.status !== 'active') {
      throw new ApiException('invalid_transition', { details: { current_status: site.status } });
    }
    if (input.vehicle_id !== undefined) {
      const vehicle = await new VehiclesRepository(uow).find(input.vehicle_id);
      if (vehicle === undefined) throw unknownReference('/body/vehicle_id');
      if (!vehicle.active) {
        throw new ApiException('driver_not_eligible', { details: { reason: 'vehicle_inactive' } });
      }
    }
    const shifts = new ShiftsRepository(uow);
    const overlap = await shifts.overlapping(driver.id, start, end);
    if (overlap !== undefined) {
      throw new ApiException('invalid_transition', {
        details: {
          current_status: overlap.status,
          version: overlap.version,
          shift_id: overlap.id,
          planned_start: overlap.plannedStart.toISOString(),
          planned_end: overlap.plannedEnd.toISOString(),
        },
      });
    }
    const row = await shifts.insert({
      id: uuidv7(),
      driverId: driver.id,
      siteId: input.site_id,
      vehicleId: input.vehicle_id ?? null,
      plannedStart: start,
      plannedEnd: end,
      status: 'planned',
    });
    await this.recordStaff(row, 'delivery.shift.planned', undefined, facts);
    return row;
  }

  /** `cancelShift` (plan 2.3): `planned` → `cancelled` by the dispatcher, with the note. */
  async cancel(id: string, note: string | undefined, facts: AuditFacts): Promise<ShiftRow> {
    const { before, after } = await this.staffMove(id, 'cancelled');
    await this.recordStaff(after, 'delivery.shift.cancelled', before, facts, note);
    return after;
  }

  /** `endShift` (plan 2.3): `active` or `paused` → `ended` by the dispatcher, with the note. */
  async endByDispatcher(
    id: string,
    note: string | undefined,
    facts: AuditFacts,
  ): Promise<ShiftRow> {
    const { before, after } = await this.staffMove(id, 'ended');
    await this.ended(after, 'dispatcher');
    this.forgetAfterCommit(after.driverId);
    await this.recordStaff(after, 'delivery.shift.ended', before, facts, note);
    return after;
  }

  /** `driverListShifts`: the token's driver's shifts. */
  async driverList(
    plan: ListPagePlan<ShiftSortField>,
    statuses: readonly ShiftStatus[] | undefined,
  ): Promise<ListPage<ShiftRow>> {
    const { driver } = await tokenDriver(getUnitOfWork());
    return this.list(plan, { statuses, driverId: driver.id });
  }

  /**
   * `driverStartShift` (plan 2.4): the named planned shift becomes `active` with the vehicle, or an
   * ad hoc shift starts at the driver's home site for 12 hours; `422 driver_not_eligible` with the
   * typed reason otherwise.
   */
  async start(
    input: { readonly vehicle_id: string; readonly shift_id?: string | undefined },
    facts: AuditFacts,
  ): Promise<ShiftRow> {
    const uow = getUnitOfWork();
    const { driver } = await this.lockedDriver();
    const shifts = new ShiftsRepository(uow);
    const vehicle = await new VehiclesRepository(uow).find(input.vehicle_id);
    const live = await shifts.live(driver.id);
    const named = input.shift_id === undefined ? undefined : await shifts.find(input.shift_id);
    const planned =
      input.shift_id === undefined
        ? undefined
        : named === undefined || named.driverId !== driver.id
          ? null
          : named;
    const now = this.now();
    const reason = ineligibleReason({
      driver: { status: driver.status, cashBlocked: driver.cashBlockedAt !== null },
      vehicle,
      liveShift: live !== undefined,
      planned,
      now,
    });
    if (reason !== undefined) {
      throw new ApiException('driver_not_eligible', { details: { reason } });
    }
    let row: ShiftRow;
    if (planned === undefined || planned === null) {
      row = await shifts.insert({
        id: uuidv7(),
        driverId: driver.id,
        siteId: driver.homeSiteId,
        vehicleId: input.vehicle_id,
        plannedStart: now,
        plannedEnd: new Date(now.getTime() + adHocShiftMs),
        status: 'active',
      });
    } else {
      transition(planned, 'active', 'driver');
      const moved = await shifts.move(planned.id, 'planned', 'active', {
        vehicleId: input.vehicle_id,
      });
      if (moved === undefined) throw new Error('The planned shift changed under the driver lock');
      row = moved;
    }
    await this.deps.outbox.enqueue(uow, {
      type: 'delivery.shift.started',
      version: 1,
      aggregate: { type: 'driver_shift', id: row.id, version: row.version },
      kind: 'internal_event',
      payload: {
        shift_id: row.id,
        driver_id: row.driverId,
        site_id: row.siteId,
        vehicle_id: row.vehicleId,
        started_at: row.startedAt?.toISOString() ?? null,
        ad_hoc: planned === undefined,
      },
    });
    await this.recordDriver(row, driver, 'delivery.shift.started', named, facts);
    return row;
  }

  /** `driverPauseShift`, `driverResumeShift`, `driverEndShift` (plan 2.4): the driver's arrows. */
  async driverMove(
    id: string,
    to: Extract<ShiftStatus, 'paused' | 'active' | 'ended'>,
    facts: AuditFacts,
  ): Promise<ShiftRow> {
    const uow = getUnitOfWork();
    const { driver } = await this.lockedDriver();
    const shifts = new ShiftsRepository(uow);
    const before = await shifts.find(id);
    if (before === undefined || before.driverId !== driver.id) throw new ApiException('not_found');
    transition(before, to, 'driver');
    const after = await shifts.move(id, before.status, to);
    if (after === undefined) throw new Error('The shift changed under the driver lock');
    if (to === 'ended') {
      await this.ended(after, 'driver');
      this.forgetAfterCommit(after.driverId);
      await this.recordDriver(after, driver, 'delivery.shift.ended', before, facts);
    }
    return after;
  }

  /**
   * The sweeper's no-shows (plan 2.5, §7 #1): every `planned` shift of the unit of work's account
   * whose `planned_start + 30 min` has passed becomes `no_show` by the system, under its driver's
   * row lock, with an audit row each (no event: nothing consumes one yet). Returns how many.
   */
  async markNoShows(runId: string): Promise<number> {
    const uow = getUnitOfWork();
    const shifts = new ShiftsRepository(uow);
    const due = await shifts.plannedStartedBy(new Date(this.now().getTime() - noShowGraceMs));
    let marked = 0;
    for (const seen of due) {
      await new DriversRepository(uow).lockDriver(seen.driverId);
      const before = await shifts.find(seen.id);
      if (before?.status !== 'planned') continue; // started or cancelled meanwhile
      transition(before, 'no_show', 'system');
      const after = await shifts.move(before.id, 'planned', 'no_show');
      if (after === undefined) continue;
      await this.recordSystem(after, 'delivery.shift.no_show', before, runId);
      marked += 1;
    }
    return marked;
  }

  /**
   * The sweeper's stale check (plan 2.8, §7 #3): every `active` shift of the account without a point
   * for 5 minutes and not alerted in the last 15 gets one `push` row to the driver's devices
   * (`stale_tracking`, in `locales`' language for the driver, Arabic otherwise), one
   * `delivery.shift.tracking_stale` event and `stale_alerted_at`. A `paused` shift is never checked.
   * Returns how many shifts were alerted.
   */
  async alertStale(locales: ReadonlyMap<string, Locale>): Promise<number> {
    const uow = getUnitOfWork();
    const now = this.now();
    const shifts = new ShiftsRepository(uow);
    const candidates = await shifts.activeNotAlertedSince(new Date(now.getTime() - staleRepeatMs));
    if (candidates.length === 0) return 0;
    const heads = new Map(
      (await new LocationHeadsRepository(uow).latestOf(candidates.map((s) => s.driverId))).map(
        (head) => [head.driverId, head.lastServerTs] as const,
      ),
    );
    let alerted = 0;
    for (const shift of candidates) {
      const lastPointAt = heads.get(shift.driverId) ?? null;
      if (shift.startedAt === null || !isStale(shift.startedAt, lastPointAt, now)) continue;
      const row = await shifts.markStaleAlerted(shift.id, now);
      if (row === undefined) continue;
      const devices = (await new DriverDevicesRepository(uow).ofDriver(row.driverId)).filter(
        (device) => device.revokedAt === null && device.pushToken !== null,
      );
      const aggregate = { type: 'driver_shift', id: row.id, version: row.version };
      await this.deps.outbox.enqueue(uow, {
        type: 'delivery.shift.tracking_stale',
        version: 1,
        aggregate,
        kind: 'push',
        payload: {
          driver_id: row.driverId,
          template: 'stale_tracking',
          params: {},
          locale: locales.get(row.driverId) ?? 'ar',
          data: { kind: 'sync', route: 'eeasydriver://sync' },
          ttl_s: staleRepeatMs / 1000,
          collapse_id: `stale:${row.id}`,
          devices: devices.map((device) => ({
            device_id: device.id,
            push_token: device.pushToken ?? '',
          })),
        },
      });
      await this.deps.outbox.enqueue(uow, {
        type: 'delivery.shift.tracking_stale',
        version: 1,
        aggregate,
        kind: 'internal_event',
        payload: {
          shift_id: row.id,
          driver_id: row.driverId,
          site_id: row.siteId,
          last_point_at: lastPointAt?.toISOString() ?? null,
          alerted_at: now.toISOString(),
        },
      });
      alerted += 1;
    }
    return alerted;
  }

  /**
   * The sweeper's overdue ends (adversary round 1, finding 1): every `active` or `paused` shift of
   * the account whose `planned_end + 60 min` has passed ends by the system (`planned_end_passed`),
   * in driver order under each driver's row lock. Returns how many.
   */
  async endOverdue(runId: string): Promise<number> {
    const cutoff = new Date(this.now().getTime() - overdueGraceMs);
    const due = await new ShiftsRepository(getUnitOfWork()).liveEndedBy(cutoff);
    return this.endBySystem(due, 'planned_end_passed', runId);
  }

  /**
   * The suspension consumer's effect (plan 2.5; PLAT-13 8.2 #35): every `active` or `paused` shift
   * of the unit of work's account ends by the system, in driver order under each driver's row lock.
   * Returns how many.
   */
  async endAllBySystem(reason: 'account_suspended', causeId: string): Promise<number> {
    const live = await new ShiftsRepository(getUnitOfWork()).liveByDriver();
    return this.endBySystem(live, reason, causeId);
  }

  /**
   * `updateDriver` taking the driver out of `active` (adversary round 1, finding 1): the driver's
   * live shift, if any, ends by the system with `driver_<status>`. The caller holds the driver row
   * lock; `requestId` is the request's.
   */
  async endDriverLive(
    driverId: string,
    reason: 'driver_suspended' | 'driver_archived',
    requestId: string,
  ): Promise<number> {
    const live = await new ShiftsRepository(getUnitOfWork()).live(driverId);
    return this.endBySystem(live === undefined ? [] : [live], reason, requestId);
  }

  /**
   * Ends each of `seen` that is still live under its driver's row lock: `delivery.shift.ended`
   * (`ended_by: system`, `reason`), an audit row with `requestId`, and the driver's latest-position
   * key deleted once the transaction commits. Returns how many ended.
   */
  private async endBySystem(
    seen: readonly ShiftRow[],
    reason: SystemEndReason,
    requestId: string,
  ): Promise<number> {
    const uow = getUnitOfWork();
    const shifts = new ShiftsRepository(uow);
    let ended = 0;
    for (const shift of seen) {
      await new DriversRepository(uow).lockDriver(shift.driverId);
      const before = await shifts.find(shift.id);
      if (before === undefined || (before.status !== 'active' && before.status !== 'paused')) {
        continue;
      }
      transition(before, 'ended', 'system');
      const after = await shifts.move(before.id, before.status, 'ended');
      if (after === undefined) continue;
      await this.ended(after, 'system', reason);
      this.forgetAfterCommit(after.driverId);
      await this.recordSystem(after, 'delivery.shift.ended', before, requestId, reason);
      ended += 1;
    }
    return ended;
  }

  /**
   * Deletes the driver's latest-position key once the unit of work commits, never before: a
   * position read between the delete and the commit would otherwise refill the maps (adversary
   * round 1, finding 3). Nothing without Redis.
   */
  private forgetAfterCommit(driverId: string): void {
    const fanout = this.deps.fanout;
    if (fanout === undefined || fanout === null) return;
    const { accountId } = getContext();
    afterCommit(() => fanout.forget(accountId, driverId));
  }

  /** The token's driver, its row lock taken and the row read again under it. */
  private async lockedDriver(): Promise<{ driver: DriverRow }> {
    const uow = getUnitOfWork();
    const { driver } = await tokenDriver(uow);
    const drivers = new DriversRepository(uow);
    await drivers.lockDriver(driver.id);
    const locked = await drivers.find(driver.id);
    if (locked === undefined) throw new ApiException('not_found');
    return { driver: locked };
  }

  /** A staff arrow on a shift under its driver's row lock. */
  private async staffMove(
    id: string,
    to: Extract<ShiftStatus, 'cancelled' | 'ended'>,
  ): Promise<{ before: ShiftRow; after: ShiftRow }> {
    const uow = getUnitOfWork();
    const shifts = new ShiftsRepository(uow);
    const seen = await shifts.find(id);
    if (seen === undefined) throw new ApiException('not_found');
    await new DriversRepository(uow).lockDriver(seen.driverId);
    const before = await shifts.find(id);
    if (before === undefined) throw new ApiException('not_found');
    transition(before, to, 'dispatcher');
    const after = await shifts.move(id, before.status, to);
    if (after === undefined) throw new Error('The shift changed under the driver lock');
    return { before, after };
  }

  /** The `delivery.shift.ended` event (plan 2.9): ids, times and who ended it. */
  private async ended(row: ShiftRow, endedBy: EndedBy, reason?: string): Promise<void> {
    await this.deps.outbox.enqueue(getUnitOfWork(), {
      type: 'delivery.shift.ended',
      version: 1,
      aggregate: { type: 'driver_shift', id: row.id, version: row.version },
      kind: 'internal_event',
      payload: {
        shift_id: row.id,
        driver_id: row.driverId,
        site_id: row.siteId,
        ended_at: row.endedAt?.toISOString() ?? null,
        ended_by: endedBy,
        ...(reason === undefined ? {} : { reason }),
      },
    });
  }

  private recordStaff(
    row: ShiftRow,
    action: string,
    before: ShiftRow | undefined,
    facts: AuditFacts,
    note?: string,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'driver_shift',
      targetId: row.id,
      action,
      ...(before === undefined ? {} : { before: auditView(before) }),
      after: { ...auditView(row), ...(note === undefined ? {} : { note }) },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
  }

  /** A system write (the sweeper, the suspension consumer): no actor id, the run or event as id. */
  private recordSystem(
    row: ShiftRow,
    action: string,
    before: ShiftRow,
    requestId: string,
    reason?: string,
  ): Promise<void> {
    return this.deps.audit.record({
      actorType: 'system',
      actorId: null,
      accountId: getContext().accountId,
      targetType: 'driver_shift',
      targetId: row.id,
      action,
      before: auditView(before),
      after: auditView(row),
      ...(reason === undefined ? {} : { reason }),
      requestId,
    });
  }

  private recordDriver(
    row: ShiftRow,
    driver: DriverRow,
    action: string,
    before: ShiftRow | undefined,
    facts: AuditFacts,
  ): Promise<void> {
    return this.deps.audit.record({
      actorType: 'driver',
      actorId: driver.id,
      accountId: getContext().accountId,
      targetType: 'driver_shift',
      targetId: row.id,
      action,
      ...(before === undefined ? {} : { before: auditView(before) }),
      after: auditView(row),
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
  }
}

/** The audited fields of a shift: ids, status and times (never a position). */
function auditView(row: ShiftRow): Record<string, unknown> {
  return {
    status: row.status,
    driver_id: row.driverId,
    site_id: row.siteId,
    vehicle_id: row.vehicleId,
    planned_start: row.plannedStart.toISOString(),
    planned_end: row.plannedEnd.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    ended_at: row.endedAt?.toISOString() ?? null,
  };
}

/** A body id that is not one of the account's (`400` at its pointer, DEL-1 8.2 #4). */
function unknownReference(pointer: string): ApiException {
  return new ApiException('validation_failed', { fields: [{ pointer, code: 'invalid' }] });
}
