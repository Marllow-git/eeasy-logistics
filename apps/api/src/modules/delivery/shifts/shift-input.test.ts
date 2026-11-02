import { describe, expect, it } from 'vitest';
import type { StartFacts } from './shift-input.js';
import { ineligibleReason, planWindowProblems } from './shift-input.js';

// DEL-5 plan 2.3, 2.4: the planning window and the typed eligibility reasons.

const now = new Date('2026-11-02T08:00:00Z');
const at = (iso: string) => new Date(iso);

describe('planWindowProblems', () => {
  it('takes a window of up to 16 hours starting within 14 days', () => {
    expect(planWindowProblems(at('2026-11-02T09:00:00Z'), at('2026-11-03T01:00:00Z'), now)).toEqual(
      [],
    );
    expect(planWindowProblems(at('2026-11-16T07:00:00Z'), at('2026-11-16T08:00:00Z'), now)).toEqual(
      [],
    );
  });

  it('refuses an empty, reversed or over-long window at planned_end', () => {
    const endProblem = [{ pointer: '/body/planned_end', code: 'invalid' }];
    expect(planWindowProblems(at('2026-11-02T09:00:00Z'), at('2026-11-02T09:00:00Z'), now)).toEqual(
      endProblem,
    );
    expect(planWindowProblems(at('2026-11-02T09:00:00Z'), at('2026-11-02T08:00:00Z'), now)).toEqual(
      endProblem,
    );
    expect(planWindowProblems(at('2026-11-02T09:00:00Z'), at('2026-11-03T01:00:01Z'), now)).toEqual(
      endProblem,
    );
  });

  it('refuses a start more than 14 days ahead at planned_start', () => {
    expect(planWindowProblems(at('2026-11-16T08:00:01Z'), at('2026-11-16T09:00:00Z'), now)).toEqual(
      [{ pointer: '/body/planned_start', code: 'invalid' }],
    );
  });
});

describe('ineligibleReason', () => {
  const eligible: StartFacts = {
    driver: { status: 'active', cashBlocked: false },
    vehicle: { active: true },
    liveShift: false,
    planned: undefined,
    now,
  };
  const planned = (start: string, end: string, status: 'planned' | 'cancelled' = 'planned') => ({
    status,
    plannedStart: at(start),
    plannedEnd: at(end),
  });

  it('lets an eligible driver start ad hoc or within the planned window', () => {
    expect(ineligibleReason(eligible)).toBeUndefined();
    // 60 minutes early is the earliest; planned_end the latest.
    expect(
      ineligibleReason({
        ...eligible,
        planned: planned('2026-11-02T09:00:00Z', '2026-11-02T17:00:00Z'),
      }),
    ).toBeUndefined();
    expect(
      ineligibleReason({
        ...eligible,
        planned: planned('2026-11-02T00:00:00Z', '2026-11-02T08:00:00Z'),
      }),
    ).toBeUndefined();
  });

  it('names each refusal, in order', () => {
    expect(
      ineligibleReason({ ...eligible, driver: { status: 'suspended', cashBlocked: true } }),
    ).toBe('driver_suspended');
    expect(ineligibleReason({ ...eligible, driver: { status: 'active', cashBlocked: true } })).toBe(
      'cash_blocked',
    );
    expect(ineligibleReason({ ...eligible, vehicle: undefined, liveShift: true })).toBe(
      'vehicle_unknown',
    );
    expect(ineligibleReason({ ...eligible, vehicle: { active: false } })).toBe('vehicle_inactive');
    expect(ineligibleReason({ ...eligible, liveShift: true, planned: null })).toBe('shift_live');
    expect(ineligibleReason({ ...eligible, planned: null })).toBe('shift_not_planned');
    expect(
      ineligibleReason({
        ...eligible,
        planned: planned('2026-11-02T09:00:00Z', '2026-11-02T17:00:00Z', 'cancelled'),
      }),
    ).toBe('shift_not_planned');
    expect(
      ineligibleReason({
        ...eligible,
        planned: planned('2026-11-02T09:00:01Z', '2026-11-02T17:00:00Z'),
      }),
    ).toBe('outside_window');
    expect(
      ineligibleReason({
        ...eligible,
        planned: planned('2026-11-02T00:00:00Z', '2026-11-02T07:59:59Z'),
      }),
    ).toBe('outside_window');
  });
});
