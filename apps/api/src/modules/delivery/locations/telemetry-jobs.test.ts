import { describe, expect, it } from 'vitest';
import type { RingPoint } from './locations.repository.js';
import { businessDateOf, retentionCutoff, splitByBusinessDate } from './telemetry-jobs.js';

// DEL-5 plan 2.8, 2.10: the business date in Riyadh, the midnight split, the 90-day cutoff.

const point = (seq: number, iso: string): RingPoint => ({
  seq,
  lat: 24.7,
  lng: 46.6,
  clientTs: new Date(iso),
});

describe('businessDateOf', () => {
  it('is the calendar day in Asia/Riyadh (UTC+3)', () => {
    expect(businessDateOf(new Date('2026-11-02T20:59:59Z'))).toBe('2026-11-02');
    expect(businessDateOf(new Date('2026-11-02T21:00:00Z'))).toBe('2026-11-03');
  });
});

describe('splitByBusinessDate', () => {
  it('splits a segment crossing midnight in Riyadh at the boundary, order kept', () => {
    const days = splitByBusinessDate([
      point(1, '2026-11-02T20:58:00Z'),
      point(2, '2026-11-02T20:59:30Z'),
      point(3, '2026-11-02T21:00:00Z'),
      point(4, '2026-11-02T21:01:00Z'),
    ]);
    expect([...days.keys()]).toEqual(['2026-11-02', '2026-11-03']);
    expect(days.get('2026-11-02')?.map((p) => p.seq)).toEqual([1, 2]);
    expect(days.get('2026-11-03')?.map((p) => p.seq)).toEqual([3, 4]);
  });

  it('keeps a day in one piece and returns nothing for no points', () => {
    expect(splitByBusinessDate([point(1, '2026-11-02T08:00:00Z')]).size).toBe(1);
    expect(splitByBusinessDate([]).size).toBe(0);
  });
});

describe('retentionCutoff', () => {
  it('is today in Riyadh minus 90 days', () => {
    expect(retentionCutoff(new Date('2026-11-02T00:30:00Z'))).toBe('2026-08-04');
    // 22:00 UTC is already the next day in Riyadh.
    expect(retentionCutoff(new Date('2026-11-02T22:00:00Z'))).toBe('2026-08-05');
  });
});
