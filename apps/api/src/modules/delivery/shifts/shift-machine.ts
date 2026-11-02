import type { ShiftStatus } from '../../kernel/public/index.js';
import { ApiException } from '../../kernel/public/index.js';

// The DriverShift state machine as data (DEL-5 plan 2.2; domain model §3.17). Every arrow names the
// actors that may take it: the driver from the app, the dispatcher from the staff doors, the system
// from the worker's sweeper (no-show) and the suspension consumer. An arrow absent here, or taken by
// another actor, is `409 invalid_transition` (errors.md).

export type ShiftActor = 'driver' | 'dispatcher' | 'system';

export interface ShiftArrow {
  readonly from: ShiftStatus;
  readonly to: ShiftStatus;
  readonly actors: readonly ShiftActor[];
}

/** The arrows of §3.17 with their actors (plan 2.2). */
export const shiftArrows: readonly ShiftArrow[] = [
  { from: 'planned', to: 'active', actors: ['driver'] },
  { from: 'planned', to: 'cancelled', actors: ['dispatcher'] },
  { from: 'planned', to: 'no_show', actors: ['system'] },
  { from: 'active', to: 'paused', actors: ['driver'] },
  { from: 'paused', to: 'active', actors: ['driver'] },
  { from: 'active', to: 'ended', actors: ['driver', 'dispatcher', 'system'] },
  { from: 'paused', to: 'ended', actors: ['dispatcher', 'system'] },
];

/** Whether `actor` may move a shift from `from` to `to`. */
export function shiftArrowAllowed(from: ShiftStatus, to: ShiftStatus, actor: ShiftActor): boolean {
  return shiftArrows.some(
    (arrow) => arrow.from === from && arrow.to === to && arrow.actors.includes(actor),
  );
}

/**
 * The checked arrow: returns `to` when `actor` may take it from the shift's current status, else
 * throws `409 invalid_transition` with `details.current_status` and `details.version`.
 */
export function transition(
  current: { readonly status: ShiftStatus; readonly version: number },
  to: ShiftStatus,
  actor: ShiftActor,
): ShiftStatus {
  if (!shiftArrowAllowed(current.status, to, actor)) {
    throw new ApiException('invalid_transition', {
      details: { current_status: current.status, version: current.version },
    });
  }
  return to;
}
