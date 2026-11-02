import type { UnitOfWork } from '@eeasy-logistics/db';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import type { SiteBody } from './site-input.js';
import { siteFields } from './site-input.js';
import { SiteUseChecks, droppedRoles, siteRoles } from './site-use.js';
import { latLngOf } from './sites.service.js';

// PLAT-12 plan 2.5, 2.6, 2.14: the site fields' rules, the in-use registry and the point's axes.

const body: SiteBody = { kind: 'branch', name_ar: 'فرع العليا', name_en: 'Olaya branch' };

function fieldsOf(input: SiteBody): unknown {
  try {
    siteFields(input);
  } catch (error) {
    if (error instanceof ApiException) return error.options.fields;
    throw error;
  }
  return [];
}

describe('siteFields', () => {
  it('clears every optional field the body leaves out', () => {
    expect(siteFields(body)).toEqual({
      kind: 'branch',
      nameAr: 'فرع العليا',
      nameEn: 'Olaya branch',
      addressText: null,
      nationalAddressShortCode: null,
      point: null,
      openingHours: [],
    });
  });

  it('upper-cases the short code and keeps the point and an overnight window', () => {
    const fields = siteFields({
      ...body,
      national_address_short_code: 'rrrd2929',
      point: { lat: 24.7136, lng: 46.6753 },
      opening_hours: [{ weekday: 4, opens: '18:00', closes: '02:00' }],
    });
    expect(fields.nationalAddressShortCode).toBe('RRRD2929');
    expect(fields.point).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(fields.openingHours).toEqual([{ weekday: 4, opens: '18:00', closes: '02:00' }]);
  });

  it('refuses names out of 1 to 120 characters or on two lines, and a long address', () => {
    expect(
      fieldsOf({
        ...body,
        name_ar: '',
        name_en: 'Two\nlines',
        address_text: 'ع'.repeat(501),
      }),
    ).toEqual([
      { pointer: '/body/name_ar', code: 'too_short' },
      { pointer: '/body/name_en', code: 'invalid' },
      { pointer: '/body/address_text', code: 'too_long' },
    ]);
    expect(fieldsOf({ ...body, name_en: 'x'.repeat(121) })).toEqual([
      { pointer: '/body/name_en', code: 'too_long' },
    ]);
    expect(fieldsOf({ ...body, name_ar: 'ف'.repeat(120), address_text: 'ع'.repeat(500) })).toEqual(
      [],
    );
  });

  it('refuses a short code that is not four letters and four digits', () => {
    for (const code of ['RRRD292', 'RRR29299', 'RRRD-2929', '٢٩٢٩RRRD']) {
      expect(fieldsOf({ ...body, national_address_short_code: code })).toEqual([
        { pointer: '/body/national_address_short_code', code: 'invalid' },
      ]);
    }
  });

  it('refuses more than 14 opening rows, a missing part and a time outside HH:MM', () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({
      weekday: index % 7,
      opens: '08:00',
      closes: '22:00',
    }));
    expect(fieldsOf({ ...body, opening_hours: rows })).toEqual([
      { pointer: '/body/opening_hours', code: 'invalid' },
    ]);
    expect(
      fieldsOf({
        ...body,
        opening_hours: [
          { opens: '8:00', closes: '24:00' },
          { weekday: 1, closes: '22:60' },
        ],
      }),
    ).toEqual([
      { pointer: '/body/opening_hours/0/weekday', code: 'required' },
      { pointer: '/body/opening_hours/0/opens', code: 'invalid' },
      { pointer: '/body/opening_hours/0/closes', code: 'invalid' },
      { pointer: '/body/opening_hours/1/opens', code: 'required' },
      { pointer: '/body/opening_hours/1/closes', code: 'invalid' },
    ]);
  });
});

describe('SiteUseChecks', () => {
  const uow = { context: {} } as unknown as UnitOfWork;

  it('names the roles a kind serves and the ones a kind change drops', () => {
    expect(siteRoles('both')).toEqual(['branch', 'warehouse']);
    expect(siteRoles('warehouse')).toEqual(['warehouse']);
    expect(droppedRoles('both', 'branch')).toEqual(['warehouse']);
    expect(droppedRoles('branch', 'warehouse')).toEqual(['branch']);
    expect(droppedRoles('branch', 'both')).toEqual([]);
  });

  it('passes every site while nothing is registered (wave 0)', async () => {
    expect(await new SiteUseChecks().reasons('site', ['branch', 'warehouse'], uow)).toEqual([]);
  });

  it('refuses with the reasons the registered checks of the roles give, once each', async () => {
    const checks = new SiteUseChecks();
    const seen: string[] = [];
    checks.register('branch', (siteId) => {
      seen.push(`orders:${siteId}`);
      return Promise.resolve(siteId === 'busy' ? 'open_orders' : undefined);
    });
    checks.register('branch', () => Promise.resolve('unsettled_cash'));
    checks.register('warehouse', () => Promise.resolve('stock_on_hand'));
    expect(await checks.reasons('busy', ['branch'], uow)).toEqual([
      'open_orders',
      'unsettled_cash',
    ]);
    expect(await checks.reasons('quiet', ['warehouse'], uow)).toEqual(['stock_on_hand']);
    expect(await checks.reasons('quiet', [], uow)).toEqual([]);
    expect(seen).toEqual(['orders:busy']);
  });
});

describe('latLngOf', () => {
  it('reads the stored point longitude first (x) into the contract latitude and longitude', () => {
    expect(latLngOf({ point: { x: 46.6753, y: 24.7136 } })).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(latLngOf({ point: null })).toBeNull();
  });
});
