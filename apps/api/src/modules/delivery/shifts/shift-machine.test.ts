import { describe, expect, it } from 'vitest';
import type { ShiftStatus } from '../../kernel/public/index.js';
import { ApiException, shiftStatuses } from '../../kernel/public/index.js';
import type { ShiftActor } from './shift-machine.js';
import { shiftArrowAllowed, transition } from './shift-machine.js';

// DEL-5 plan 2.2: the full table of §3.17 with its actors. Every (from, to, actor) triple outside
// the expected set is refused, so a new arrow cannot slip in unnoticed.

const actors: readonly ShiftActor[] = ['driver', 'dispatcher', 'system'];

const expected = new Set([
  'planned>active:driver',
  'planned>cancelled:dispatcher',
  'planned>no_show:system',
  'active>paused:driver',
  'paused>active:driver',
  'active>ended:driver',
  'active>ended:dispatcher',
  'active>ended:system',
  'paused>ended:dispatcher',
  'paused>ended:system',
]);

describe('shift machine (§3.17)', () => {
  it('allows exactly the arrows of the table, each for its actors', () => {
    const allowed: string[] = [];
    for (const from of shiftStatuses) {
      for (const to of shiftStatuses) {
        for (const actor of actors) {
          if (shiftArrowAllowed(from, to, actor)) allowed.push(`${from}>${to}:${actor}`);
        }
      }
    }
    expect(new Set(allowed)).toEqual(expected);
  });

  it('leaves the terminal statuses with no way out', () => {
    for (const from of ['ended', 'cancelled', 'no_show'] as const satisfies ShiftStatus[]) {
      for (const to of shiftStatuses) {
        for (const actor of actors) expect(shiftArrowAllowed(from, to, actor)).toBe(false);
      }
    }
  });

  it('refuses a driver ending a paused shift (the dispatcher may)', () => {
    expect(shiftArrowAllowed('paused', 'ended', 'driver')).toBe(false);
    expect(shiftArrowAllowed('paused', 'ended', 'dispatcher')).toBe(true);
  });

  it('answers 409 invalid_transition with the current status and version', () => {
    expect(transition({ status: 'active', version: 3 }, 'paused', 'driver')).toBe('paused');
    let thrown: unknown;
    try {
      transition({ status: 'ended', version: 4 }, 'ended', 'driver');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiException);
    const exception = thrown as ApiException;
    expect(exception.code).toBe('invalid_transition');
    expect(exception.status).toBe(409);
    expect(exception.options.details).toEqual({ current_status: 'ended', version: 4 });
  });
});
