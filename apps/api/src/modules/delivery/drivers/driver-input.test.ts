import { describe, expect, it } from 'vitest';
import { ApiException } from '../../kernel/public/index.js';
import {
  capacityRefusal,
  driverMatches,
  homeSiteRefusal,
  personProblems,
  statusChangeAllowed,
} from './driver-input.js';

// DEL-4 plan 2.2, 2.4: the staff driver doors' input rules.

describe('personProblems', () => {
  it('normalises a Saudi number in any spelling to E.164', () => {
    for (const spelling of [
      '0551234567',
      '+966551234567',
      '966 55 123 4567',
      '+966 (55) 123-4567',
    ]) {
      expect(personProblems({ name: 'Driver', phone: spelling })).toEqual({
        problems: [],
        phone: '+966551234567',
      });
    }
  });

  it('refuses a phone that is not a number, and a name that is empty, long or on two lines', () => {
    expect(personProblems({ name: 'Driver', phone: 'call me' }).problems).toEqual([
      { pointer: '/body/phone', code: 'invalid' },
    ]);
    expect(personProblems({ name: 'Driver', phone: '12345' }).phone).toBeUndefined();
    expect(personProblems({ name: '', phone: '0551234567' }).problems).toEqual([
      { pointer: '/body/name', code: 'too_short' },
    ]);
    expect(personProblems({ name: 'ن'.repeat(121), phone: '0551234567' }).problems).toEqual([
      { pointer: '/body/name', code: 'too_long' },
    ]);
    expect(personProblems({ name: 'ن'.repeat(120), phone: '0551234567' }).problems).toEqual([]);
    expect(personProblems({ name: 'A\nB', phone: 'x' }).problems).toEqual([
      { pointer: '/body/name', code: 'invalid' },
      { pointer: '/body/phone', code: 'invalid' },
    ]);
  });
});

describe('homeSiteRefusal', () => {
  const site = (
    kind: 'branch' | 'warehouse' | 'both',
    status: 'active' | 'inactive' = 'active',
  ) => ({
    id: '00000000-0000-4000-8000-000000000001',
    kind,
    status,
  });

  it('takes an active branch or both-kind site', () => {
    expect(homeSiteRefusal(site('branch'))).toBeUndefined();
    expect(homeSiteRefusal(site('both'))).toBeUndefined();
  });

  it('answers 400 for no site or an inactive one, and 422 site_kind_mismatch for a warehouse', () => {
    for (const refused of [
      homeSiteRefusal(undefined),
      homeSiteRefusal(site('branch', 'inactive')),
    ]) {
      expect(refused).toBeInstanceOf(ApiException);
      expect(refused?.code).toBe('validation_failed');
      expect(refused?.options.fields).toEqual([{ pointer: '/body/home_site_id', code: 'invalid' }]);
    }
    expect(homeSiteRefusal(site('warehouse'))?.code).toBe('site_kind_mismatch');
  });
});

describe('statusChangeAllowed', () => {
  it('moves active and suspended both ways and either to archived, never out of archived', () => {
    expect(statusChangeAllowed('active', 'suspended')).toBe(true);
    expect(statusChangeAllowed('suspended', 'active')).toBe(true);
    expect(statusChangeAllowed('active', 'archived')).toBe(true);
    expect(statusChangeAllowed('suspended', 'archived')).toBe(true);
    expect(statusChangeAllowed('archived', 'active')).toBe(false);
    expect(statusChangeAllowed('archived', 'suspended')).toBe(false);
    expect(statusChangeAllowed('archived', 'archived')).toBe(true);
  });
});

describe('capacityRefusal', () => {
  it('refuses a limit below the orders the driver holds, and allows zero with none', () => {
    expect(capacityRefusal(0, 0)).toBeUndefined();
    expect(capacityRefusal(3, 3)).toBeUndefined();
    expect(capacityRefusal(2, 3)?.code).toBe('capacity_exceeded');
  });
});

describe('driverMatches', () => {
  const person = { name: 'Fahad Al-Harbi', phone: '+966551234567' };

  it('matches the name case-insensitively and the phone by its last digits', () => {
    expect(driverMatches(person, 'fahad')).toBe(true);
    expect(driverMatches(person, 'AL-HAR')).toBe(true);
    expect(driverMatches(person, '4567')).toBe(true);
    expect(driverMatches(person, '45 67')).toBe(true);
  });

  it('never matches the middle of a phone or a single digit', () => {
    expect(driverMatches(person, '5512')).toBe(false);
    expect(driverMatches(person, '7')).toBe(false);
    expect(driverMatches({ name: 'X', phone: null }, '4567')).toBe(false);
  });
});
