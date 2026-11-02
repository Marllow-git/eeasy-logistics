import { describe, expect, it, vi } from 'vitest';
import { geocodeConfidenceThreshold, intakeOutcome, locate, overBudget } from './intake.js';
import type { OrderAddressFields } from './order-input.js';

// The intake decision table (DEL-2 plan 2.6, D-3) and the geocode order of integrations §6.2
// (plan 2.4): a sent point, then the short code, then the text at or above the threshold.

describe('intakeOutcome (rule × located × covered)', () => {
  const zone = '0192f100-1111-7222-8333-444455556666';
  it.each([
    ['auto_accept', true, zone, 'accepted', null],
    ['auto_accept', true, null, 'pending', 'outside_coverage'],
    ['auto_accept', false, null, 'pending', 'needs_location'],
    ['receive_as_pending', true, zone, 'pending', null],
    ['receive_as_pending', true, null, 'pending', 'outside_coverage'],
    ['receive_as_pending', false, null, 'pending', 'needs_location'],
  ] as const)('%s, located %s, zone %s → %s (%s)', (rule, located, zoneId, status, reason) => {
    expect(intakeOutcome(rule, located, zoneId)).toEqual({ status, pendingReason: reason });
  });
});

describe('locate', () => {
  const address = (overrides: Partial<OrderAddressFields> = {}): OrderAddressFields => ({
    text: 'Al Olaya',
    city: 'Riyadh',
    district: null,
    shortCode: null,
    point: null,
    ...overrides,
  });
  const olaya = { lat: 24.695, lng: 46.685 };
  const geocoder = (
    found: { confidence: number } | 'not_found' | 'unavailable',
    code: 'hit' | 'not_found' = 'not_found',
  ) => ({
    lookupShortCode: vi.fn(() =>
      Promise.resolve(
        code === 'hit'
          ? {
              kind: 'found' as const,
              point: olaya,
              confidence: 1,
              addressAr: 'العليا',
              addressEn: 'Al Olaya',
              shortCode: 'REMA7572',
              provider: 'stub' as const,
            }
          : { kind: 'not_found' as const },
      ),
    ),
    geocode: vi.fn(() =>
      Promise.resolve(
        found === 'not_found'
          ? { kind: 'not_found' as const }
          : found === 'unavailable'
            ? { kind: 'unavailable' as const, reason: 'transient' as const }
            : {
                kind: 'found' as const,
                point: olaya,
                confidence: found.confidence,
                formatted: 'Al Olaya, Riyadh',
                provider: 'stub' as const,
              },
      ),
    ),
  });

  it('takes a sent point as manual without asking the geocoder', async () => {
    const source = geocoder('not_found');
    expect(await locate(source, address({ point: olaya }), 'ar')).toEqual({
      point: olaya,
      pinSource: 'manual',
      confidence: 1,
    });
    expect(source.lookupShortCode).not.toHaveBeenCalled();
    expect(source.geocode).not.toHaveBeenCalled();
  });

  it('takes a short code hit before the text, degraded', async () => {
    const source = geocoder('not_found', 'hit');
    expect(await locate(source, address({ shortCode: 'REMA7572' }), 'en')).toEqual({
      point: olaya,
      pinSource: 'geocoded',
      confidence: 1,
    });
    expect(source.lookupShortCode).toHaveBeenCalledWith('REMA7572', { degraded: true });
    expect(source.geocode).not.toHaveBeenCalled();
  });

  it('falls back to the text with its city and keeps it at or above the threshold only', async () => {
    const at = geocoder({ confidence: geocodeConfidenceThreshold });
    expect(await locate(at, address({ shortCode: 'RZZZ0000' }), 'en')).toMatchObject({
      pinSource: 'geocoded',
      confidence: 0.6,
    });
    expect(at.geocode).toHaveBeenCalledWith(
      { text: 'Al Olaya', city: 'Riyadh', locale: 'en' },
      { degraded: true },
    );
    expect(await locate(geocoder({ confidence: 0.5 }), address(), 'ar')).toBeUndefined();
    expect(await locate(geocoder('not_found'), address(), 'ar')).toBeUndefined();
    expect(await locate(geocoder('unavailable'), address(), 'ar')).toBeUndefined();
  });

  it("charges the account's budget once before any provider call, and skips past it (ruling 2)", async () => {
    const spent = geocoder({ confidence: 0.9 }, 'hit');
    const refuse = vi.fn(() => Promise.resolve(false));
    expect(await locate(spent, address({ shortCode: 'REMA7572' }), 'ar', { budget: refuse })).toBe(
      overBudget,
    );
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(spent.lookupShortCode).not.toHaveBeenCalled();
    expect(spent.geocode).not.toHaveBeenCalled();

    const allow = vi.fn(() => Promise.resolve(true));
    const asked = geocoder({ confidence: 0.9 });
    expect(
      await locate(asked, address({ shortCode: 'RZZZ0000' }), 'ar', { budget: allow }),
    ).toMatchObject({ pinSource: 'geocoded' });
    expect(allow).toHaveBeenCalledTimes(1);
    expect(asked.lookupShortCode).toHaveBeenCalledTimes(1);
    expect(asked.geocode).toHaveBeenCalledTimes(1);

    // A sent point asks no provider, so it is never charged.
    const untouched = vi.fn(() => Promise.resolve(false));
    expect(
      await locate(asked, address({ point: olaya }), 'ar', { budget: untouched }),
    ).toMatchObject({ pinSource: 'manual' });
    expect(untouched).not.toHaveBeenCalled();
  });

  it('passes what is left of its deadline to each call and stops when it is spent', async () => {
    let clock = 0;
    const source = geocoder({ confidence: 0.9 });
    source.lookupShortCode.mockImplementationOnce(() => {
      clock += 1_500;
      return Promise.resolve({ kind: 'not_found' as const });
    });
    await locate(source, address({ shortCode: 'RZZZ0000' }), 'ar', {
      deadlineMs: 2_000,
      now: () => clock,
    });
    expect(source.lookupShortCode).toHaveBeenCalledWith('RZZZ0000', {
      degraded: true,
      deadlineMs: 2_000,
    });
    expect(source.geocode).toHaveBeenCalledWith(expect.anything(), {
      degraded: true,
      deadlineMs: 500,
    });

    source.lookupShortCode.mockImplementationOnce(() => {
      clock += 2_000;
      return Promise.resolve({ kind: 'not_found' as const });
    });
    source.geocode.mockClear();
    expect(
      await locate(source, address({ shortCode: 'RZZZ0000' }), 'ar', {
        deadlineMs: 2_000,
        now: () => clock,
      }),
    ).toBeUndefined();
    expect(source.geocode).not.toHaveBeenCalled();
  });
});
