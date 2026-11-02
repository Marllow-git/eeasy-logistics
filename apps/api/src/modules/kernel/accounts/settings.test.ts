import { describe, expect, it } from 'vitest';
import { defaultAccountLimits, effectiveLimits } from './limits.js';
import {
  accountSettingsDefaults,
  effectiveSettings,
  maxReasonCodes,
  mergeSettings,
  settingsProblems,
} from './settings.js';

// PLAT-12 plan 2.2, 2.3, 2.14: the limits over their defaults, the settings over theirs, the rules
// beyond the contract's schema and the PATCH merge.

const reason = (code: string, label = 'Label') => ({ code, label_ar: 'سبب', label_en: label });

describe('effectiveLimits', () => {
  it('reads every default when nothing is stored', () => {
    expect(effectiveLimits({})).toEqual({
      orders_per_month: 5000,
      drivers: 25,
      sites: 5,
      api_keys: 5,
    });
    expect(effectiveLimits(null)).toEqual(defaultAccountLimits);
  });

  it('takes a stored non-negative integer per key and the default for the rest', () => {
    expect(effectiveLimits({ sites: 2, drivers: 0 })).toEqual({
      orders_per_month: 5000,
      drivers: 0,
      sites: 2,
      api_keys: 5,
    });
  });

  it('ignores malformed values and unknown keys', () => {
    expect(
      effectiveLimits({ sites: -1, drivers: 2.5, api_keys: '9', orders_per_month: null, seats: 3 }),
    ).toEqual(defaultAccountLimits);
  });
});

describe('effectiveSettings', () => {
  it('reads the plan defaults for an account that set nothing', () => {
    expect(effectiveSettings({})).toEqual({
      intake_rule: 'receive_as_pending',
      max_attempts: 3,
      proof_policy: { delivery: [], cod: [] },
      reason_codes: [],
      auto_dispatch: { enabled: false },
      second_factor_required: false,
      allowed_cod_methods: ['cash'],
      embed_origins: [],
      offline_window_hours: 12,
    });
    expect(effectiveSettings('junk')).toEqual(effectiveSettings({}));
  });

  it('lays stored keys over the defaults, nested objects key by key', () => {
    const settings = effectiveSettings({
      max_attempts: 5,
      auto_dispatch: { offer_ttl_s: 60 },
      proof_policy: { cod: ['photo'] },
      receipt_tolerance_pct: 2,
    });
    expect(settings).toMatchObject({
      max_attempts: 5,
      auto_dispatch: { enabled: false, offer_ttl_s: 60 },
      proof_policy: { delivery: [], cod: ['photo'] },
      receipt_tolerance_pct: 2,
      intake_rule: 'receive_as_pending',
    });
  });
});

describe('settingsProblems', () => {
  it('accepts the contract-shaped values within the rules', () => {
    expect(
      settingsProblems({
        reason_codes: [reason('no_answer'), reason('wrong_address', 'x'.repeat(80))],
        allowed_cod_methods: ['cash'],
      }),
    ).toEqual([]);
  });

  it('refuses more than 100 reason codes', () => {
    const codes = Array.from({ length: maxReasonCodes + 1 }, (_, index) => reason(`r_${index}`));
    expect(settingsProblems({ reason_codes: codes })).toEqual([
      { pointer: '/body/reason_codes', code: 'invalid' },
    ]);
  });

  it('refuses a code outside ^[a-z0-9_]{2,40}$ and a repeated code', () => {
    expect(
      settingsProblems({
        reason_codes: [
          reason('a'),
          reason('No_Answer'),
          reason('x'.repeat(41)),
          reason('ok_code'),
          reason('ok_code'),
        ],
      }),
    ).toEqual([
      { pointer: '/body/reason_codes/0/code', code: 'invalid' },
      { pointer: '/body/reason_codes/1/code', code: 'invalid' },
      { pointer: '/body/reason_codes/2/code', code: 'invalid' },
      { pointer: '/body/reason_codes/4/code', code: 'invalid' },
    ]);
  });

  it('refuses an empty label, one over 80 characters and one with a line break', () => {
    expect(
      settingsProblems({
        reason_codes: [
          { code: 'empty', label_ar: '', label_en: 'ok' },
          { code: 'long', label_ar: 'ب'.repeat(81), label_en: 'ok' },
          { code: 'broken', label_ar: 'ok', label_en: 'two\nlines' },
          { code: 'separator', label_ar: 'ok', label_en: `one${String.fromCodePoint(0x2028)}two` },
        ],
      }),
    ).toEqual([
      { pointer: '/body/reason_codes/0/label_ar', code: 'too_short' },
      { pointer: '/body/reason_codes/1/label_ar', code: 'too_long' },
      { pointer: '/body/reason_codes/2/label_en', code: 'invalid' },
      { pointer: '/body/reason_codes/3/label_en', code: 'invalid' },
    ]);
  });

  it('counts characters, not UTF-16 units: 80 emoji are 80 characters', () => {
    expect(settingsProblems({ reason_codes: [reason('emoji', '🚚'.repeat(80))] })).toEqual([]);
  });

  it('holds digital COD methods behind the owner gate of ADR-0017', () => {
    expect(settingsProblems({ allowed_cod_methods: ['cash', 'mada'] })).toEqual([
      { pointer: '/body/allowed_cod_methods', code: 'owner_gate' },
    ]);
  });
});

describe('mergeSettings', () => {
  it('replaces only the sent fields, whatever defaults the parsed body carries', () => {
    const stored = { max_attempts: 5, offline_window_hours: 24 };
    // The contract's schema filled max_attempts, allowed_cod_methods and offline_window_hours.
    const parsed = {
      intake_rule: 'auto_accept',
      max_attempts: 3,
      allowed_cod_methods: ['cash'],
      offline_window_hours: 12,
    };
    const change = mergeSettings(stored, parsed, ['intake_rule']);
    expect(change.stored).toEqual({
      max_attempts: 5,
      offline_window_hours: 24,
      intake_rule: 'auto_accept',
    });
    expect(change.changed).toEqual(['intake_rule']);
    expect(change.before).toEqual({ intake_rule: 'receive_as_pending' });
    expect(change.after).toEqual({ intake_rule: 'auto_accept' });
  });

  it('lists the changed keys only, with their effective values before and after', () => {
    const change = mergeSettings(
      { second_factor_required: false, max_attempts: 4 },
      { second_factor_required: true, max_attempts: 4, reason_codes: [] },
      ['second_factor_required', 'max_attempts', 'reason_codes'],
    );
    expect(change.changed).toEqual(['second_factor_required']);
    expect(change.before).toEqual({ second_factor_required: false });
    expect(change.after).toEqual({ second_factor_required: true });
  });

  it('changes nothing when every sent value equals the effective one', () => {
    const change = mergeSettings({}, { max_attempts: 3, allowed_cod_methods: ['cash'] }, [
      'max_attempts',
      'allowed_cod_methods',
    ]);
    expect(change.changed).toEqual([]);
    expect(change.before).toEqual({});
  });

  it('never stores a default it was not sent', () => {
    const change = mergeSettings({}, accountSettingsDefaults, ['second_factor_required']);
    expect(Object.keys(change.stored)).toEqual(['second_factor_required']);
  });
});
