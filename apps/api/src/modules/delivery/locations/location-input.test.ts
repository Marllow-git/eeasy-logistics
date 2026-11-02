import { describe, expect, it } from 'vitest';
import type { PointInput } from './location-input.js';
import { pointProblems, ringSlots, selectPoints } from './location-input.js';

// DEL-5 plan 2.6, 2.10: the point validator, the drop rules and the slot arithmetic across the wrap.

const now = new Date('2026-11-02T08:00:00Z');
const point = (clientTs: string, extra: Partial<PointInput> = {}): PointInput => ({
  client_ts: clientTs,
  lat: 24.7136,
  lng: 46.6753,
  ...extra,
});

describe('pointProblems', () => {
  it('accepts points in range and names each field out of range by its pointer', () => {
    expect(
      pointProblems([point('2026-11-02T07:59:00Z', { accuracy_m: 0, battery_pct: 100 })]),
    ).toEqual([]);
    expect(
      pointProblems([
        point('2026-11-02T07:59:00Z'),
        point('2026-11-02T07:59:10Z', {
          lat: 90.1,
          lng: -180.5,
          accuracy_m: 10_001,
          battery_pct: 101,
        }),
        point('not a time', { accuracy_m: -1, speed_mps: Number.NaN }),
      ]),
    ).toEqual([
      { pointer: '/body/points/1/lat', code: 'invalid' },
      { pointer: '/body/points/1/lng', code: 'invalid' },
      { pointer: '/body/points/1/accuracy_m', code: 'invalid' },
      { pointer: '/body/points/1/battery_pct', code: 'invalid' },
      { pointer: '/body/points/2/client_ts', code: 'invalid' },
      { pointer: '/body/points/2/accuracy_m', code: 'invalid' },
      { pointer: '/body/points/2/speed_mps', code: 'invalid' },
    ]);
  });

  it('bounds speed to 0..100 m/s and heading to 0..360 degrees (adversary L-b)', () => {
    expect(
      pointProblems([
        point('2026-11-02T07:59:00Z', { speed_mps: 0, heading_deg: 0 }),
        point('2026-11-02T07:59:01Z', { speed_mps: 100, heading_deg: 360 }),
      ]),
    ).toEqual([]);
    expect(
      pointProblems([
        point('2026-11-02T07:59:00Z', { speed_mps: -0.1, heading_deg: -1 }),
        point('2026-11-02T07:59:01Z', { speed_mps: 100.5, heading_deg: 360.5 }),
      ]),
    ).toEqual([
      { pointer: '/body/points/0/speed_mps', code: 'invalid' },
      { pointer: '/body/points/0/heading_deg', code: 'invalid' },
      { pointer: '/body/points/1/speed_mps', code: 'invalid' },
      { pointer: '/body/points/1/heading_deg', code: 'invalid' },
    ]);
  });
});

describe('selectPoints', () => {
  it('keeps points oldest first and drops future, too old and not newer ones', () => {
    const { kept, dropped } = selectPoints(
      [
        point('2026-11-02T07:59:30Z', { is_charging: true, power_saver: false }),
        point('2026-11-02T07:59:00Z'),
        point('2026-11-02T07:59:00Z'), // a duplicate of the one before
        point('2026-11-02T08:01:01Z'), // more than 60 seconds ahead
        point('2026-11-02T08:00:40Z'), // ahead within 60 seconds: kept at the server time
        point('2026-11-02T08:00:50Z'), // the same, but no longer newer once stored at now
        point('2026-11-01T07:59:59Z'), // more than 24 hours back
        point('2026-11-02T07:50:00Z'), // not newer than the head
      ],
      now,
      new Date('2026-11-02T07:55:00Z'),
    );
    expect(kept.map((p) => p.clientTs.toISOString())).toEqual([
      '2026-11-02T07:59:00.000Z',
      '2026-11-02T07:59:30.000Z',
      '2026-11-02T08:00:00.000Z',
    ]);
    expect(kept[1]).toMatchObject({ isCharging: true, powerSaver: false, accuracyM: null });
    expect(dropped).toEqual({ stale: 3, future: 1, too_old: 1 });
  });

  it('caps a clock-ahead point at the server time, so the next batch is not blocked (L-d)', () => {
    const first = selectPoints([point('2026-11-02T08:00:59Z')], now, null);
    expect(first.kept.map((p) => p.clientTs.toISOString())).toEqual(['2026-11-02T08:00:00.000Z']);
    // Ten seconds later the same phone (still 59 s ahead) sends its next point: kept, capped again.
    const later = new Date('2026-11-02T08:00:10Z');
    const next = selectPoints(
      [point('2026-11-02T08:01:09Z')],
      later,
      first.kept[0]?.clientTs ?? null,
    );
    expect(next.kept.map((p) => p.clientTs.toISOString())).toEqual(['2026-11-02T08:00:10.000Z']);
  });

  it('keeps every valid point when the driver has none yet', () => {
    expect(selectPoints([point('2026-11-01T08:00:00Z')], now, null).kept).toHaveLength(1);
  });
});

describe('ringSlots', () => {
  it('numbers new points up to the head and wraps the slot at 240', () => {
    expect(ringSlots(3, 3)).toEqual([
      { seq: 1, slot: 1 },
      { seq: 2, slot: 2 },
      { seq: 3, slot: 3 },
    ]);
    expect(ringSlots(241, 4)).toEqual([
      { seq: 238, slot: 238 },
      { seq: 239, slot: 239 },
      { seq: 240, slot: 0 },
      { seq: 241, slot: 1 },
    ]);
    expect(ringSlots(250, 20).map((entry) => entry.slot)).toEqual([
      231, 232, 233, 234, 235, 236, 237, 238, 239, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});
