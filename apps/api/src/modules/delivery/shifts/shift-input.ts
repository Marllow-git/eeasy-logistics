import type { FieldProblem, ShiftStatus } from '../../kernel/public/index.js';

// The shift rules that need no database (DEL-5 plan 2.3, 2.4; owner questions §7 #1, #2 on their
// defaults): the planning window, the start window of a planned shift, the ad hoc shift's length
// and the typed eligibility reasons of `422 driver_not_eligible`.

const minute = 60_000;
const hour = 60 * minute;

/** A planned shift lasts at most 16 hours and starts at most 14 days ahead (plan 2.3). */
export const maxPlannedShiftMs = 16 * hour;
export const maxPlanAheadMs = 14 * 24 * hour;
/** A planned shift may start 60 minutes before `planned_start`, not after `planned_end` (§7 #2). */
export const earlyStartMs = 60 * minute;
/** An ad hoc shift is planned for 12 hours from its start (§7 #2). */
export const adHocShiftMs = 12 * hour;

/** The planning window's problems (`400 validation_failed`), empty when the window is fine. */
export function planWindowProblems(start: Date, end: Date, now: Date): FieldProblem[] {
  if (end.getTime() <= start.getTime() || end.getTime() - start.getTime() > maxPlannedShiftMs) {
    return [{ pointer: '/body/planned_end', code: 'invalid' }];
  }
  if (start.getTime() - now.getTime() > maxPlanAheadMs) {
    return [{ pointer: '/body/planned_start', code: 'invalid' }];
  }
  return [];
}

/** The reasons `driverStartShift` refuses with (`details.reason`, plan 2.4). */
export type IneligibleReason =
  | 'driver_suspended'
  | 'cash_blocked'
  | 'vehicle_unknown'
  | 'vehicle_inactive'
  | 'shift_live'
  | 'shift_not_planned'
  | 'outside_window';

export interface StartFacts {
  readonly driver: { readonly status: string; readonly cashBlocked: boolean };
  /** The named vehicle of the account, or undefined when it is not one. */
  readonly vehicle: { readonly active: boolean } | undefined;
  /** Whether the driver already holds an `active` or `paused` shift. */
  readonly liveShift: boolean;
  /**
   * The named planned shift: undefined for an ad hoc start, `null` when the id is not one of the
   * driver's shifts.
   */
  readonly planned:
    | { readonly status: ShiftStatus; readonly plannedStart: Date; readonly plannedEnd: Date }
    | null
    | undefined;
  readonly now: Date;
}

/** The first reason the driver may not start, in the order the app should show them; or none. */
export function ineligibleReason(facts: StartFacts): IneligibleReason | undefined {
  if (facts.driver.status !== 'active') return 'driver_suspended';
  if (facts.driver.cashBlocked) return 'cash_blocked';
  if (facts.vehicle === undefined) return 'vehicle_unknown';
  if (!facts.vehicle.active) return 'vehicle_inactive';
  if (facts.liveShift) return 'shift_live';
  const { planned } = facts;
  if (planned === undefined) return undefined;
  if (planned === null || planned.status !== 'planned') return 'shift_not_planned';
  const now = facts.now.getTime();
  if (now < planned.plannedStart.getTime() - earlyStartMs || now > planned.plannedEnd.getTime()) {
    return 'outside_window';
  }
  return undefined;
}
