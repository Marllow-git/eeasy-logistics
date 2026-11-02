import { describe, expect, it } from 'vitest';
import { ApiException } from '../../kernel/public/index.js';
import type { OrderStatus } from '../../kernel/public/index.js';
import { orderPatchFields } from './order-input.js';
import { assertEditable, changedParts } from './order-updates.js';

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
