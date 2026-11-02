import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../kernel/public/index.js';
import type { OrderStatus } from '../../kernel/public/index.js';
import { orderPatchFields } from './order-input.js';
import type { OrderAddressFields, OrderPatch } from './order-input.js';
import { assertEditable, changedParts, relocationFor } from './order-updates.js';
import type { OrderRow } from './orders.repository.js';

// DEL-2 item D: the edit rules of `updateOrder` (plan 2.8; domain model §3.2, D-4).

function refusal(run: () => unknown): ApiException {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const every = ['recipient', 'address', 'items', 'cod_amount', 'notes'] as const;

describe('assertEditable', () => {
  it.each<OrderStatus>(['pending', 'accepted', 'offered', 'assigned'])(
    'lets every part change while %s',
    (status) => {
      expect(() => assertEditable({ status, version: 3 }, every)).not.toThrow();
    },
  );

  it.each<OrderStatus>(['picked_up', 'out_for_delivery', 'attempted', 'failed'])(
    'locks recipient, address, items and COD but not notes once %s',
    (status) => {
      expect(() => assertEditable({ status, version: 3 }, ['notes'])).not.toThrow();
      const error = refusal(() => assertEditable({ status, version: 3 }, every));
      expect(error.code).toBe('order_locked');
      expect(error.options.details).toEqual({
        current_status: status,
        version: 3,
        locked: ['recipient', 'address', 'items', 'cod_amount'],
      });
    },
  );

  it.each<OrderStatus>(['delivered', 'returned', 'cancelled'])(
    'locks every part of a %s order',
    (status) => {
      const error = refusal(() => assertEditable({ status, version: 9 }, ['notes']));
      expect(error.code).toBe('order_locked');
      expect(error.options.details).toMatchObject({ locked: ['notes'] });
    },
  );
});

describe('orderPatchFields and changedParts', () => {
  it('keeps only the sent parts, checked by the create rules', () => {
    const patch = orderPatchFields(
      {
        recipient: { name: ' منى ', phone: '0500000123' },
        notes: '  ',
      },
      ['recipient', 'notes'],
      'delivery',
    );
    expect(patch).toEqual({
      recipient: { name: 'منى', phone: '+966500000123', altPhone: null, language: null },
      notes: null,
    });
    expect(changedParts(patch)).toEqual(['recipient', 'notes']);
  });

  it('turns return items inbound and refuses COD on a kind that collects nothing', () => {
    const patch = orderPatchFields(
      { items: [{ name_ar: 'حذاء', name_en: 'Shoe', quantity: 1, direction: 'out' }] },
      ['items'],
      'return_pickup',
    );
    expect(patch.items?.[0]?.direction).toBe('in');
    const error = refusal(() =>
      orderPatchFields({ cod_amount: { amount: 500 } }, ['cod_amount'], 'pickup_request'),
    );
    expect(error.code).toBe('cod_not_allowed');
  });

  it('answers every field problem at its pointer', () => {
    const error = refusal(() =>
      orderPatchFields(
        {
          address: { text: 'a\nb', city: 'الرياض' },
          items: [{ name_ar: 'x', name_en: 'y', quantity: 10_000, direction: 'in' }],
        },
        ['address', 'items'],
        'delivery',
      ),
    );
    expect(error.code).toBe('validation_failed');
    expect(error.options.fields?.map((field) => field.pointer)).toEqual([
      '/body/address/text',
      '/body/items/0/quantity',
      '/body/items/0/direction',
    ]);
  });
});

describe('relocationFor (adversary round 1, ruling 2)', () => {
  const order = {
    pinSource: 'geocoded',
    addressText: 'Al Olaya',
    addressCity: 'Riyadh',
    addressDistrict: null,
    nationalAddressShortCode: null,
    recipientLanguage: 'ar',
  } as unknown as OrderRow;
  const address = (overrides: Partial<OrderAddressFields> = {}): OrderPatch => ({
    address: {
      text: 'Al Olaya',
      city: 'Riyadh',
      district: null,
      shortCode: null,
      point: null,
      ...overrides,
    },
  });
  const geocoder = () => ({
    lookupShortCode: vi.fn(() => Promise.resolve({ kind: 'not_found' as const })),
    geocode: vi.fn(() =>
      Promise.resolve({
        kind: 'found' as const,
        point: { lat: 24.7, lng: 46.7 },
        confidence: 0.9,
        formatted: 'Al Malaz',
        provider: 'stub' as const,
      }),
    ),
  });

  it('asks nothing when the text, city, district and short code are unchanged', async () => {
    const source = geocoder();
    const budget = vi.fn(() => Promise.resolve(true));
    expect(await relocationFor(source, order, address(), { budget })).toEqual({ kind: 'kept' });
    expect(source.geocode).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
  });

  it('asks again when any of them changed, and keeps the point past the budget', async () => {
    for (const changed of [
      { text: 'Al Malaz' },
      { city: 'Jeddah' },
      { district: 'Olaya' },
      { shortCode: 'RZZZ0000' },
    ]) {
      const source = geocoder();
      expect(await relocationFor(source, order, address(changed))).toMatchObject({
        kind: 'located',
        located: { pinSource: 'geocoded' },
      });
    }
    const source = geocoder();
    const spent = vi.fn(() => Promise.resolve(false));
    expect(
      await relocationFor(source, order, address({ text: 'Al Malaz' }), { budget: spent }),
    ).toEqual({ kind: 'kept' });
    expect(spent).toHaveBeenCalledTimes(1);
    expect(source.geocode).not.toHaveBeenCalled();
  });
});
