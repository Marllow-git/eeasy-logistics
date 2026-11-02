import { describe, expect, it } from 'vitest';
import { ApiException } from '../../kernel/public/index.js';
import type { CreateOrderBody } from './order-input.js';
import { maxCodAmount, newOrderFields, orderPatchFields } from './order-input.js';

// The create rules beyond the schema (DEL-2 plan 2.3; D-4; §3.1, §3.2): COD by kind, item
// directions by kind, the bounds in code points, phones normalised, `slot_id` refused. Bodies are
// what the contract schema hands the handler: an item's `direction` defaults to `out` there.

const body = (overrides: Record<string, unknown> = {}): CreateOrderBody => {
  const raw = {
    kind: 'delivery',
    site_id: '0192f100-1111-7222-8333-444455556666',
    recipient: { name: ' سارة ', phone: '+966500000001' },
    address: { text: 'Olaya St', city: 'Riyadh' },
    items: [{ name_ar: 'قميص', name_en: 'Shirt', quantity: 2 }],
    ...overrides,
  } as { items?: Record<string, unknown>[] };
  return {
    ...raw,
    items: raw.items?.map((item) => ({ direction: 'out', ...item })),
  } as unknown as CreateOrderBody;
};

function refusal(run: () => unknown): { code: string; fields: unknown; details: unknown } {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiException) {
      return { code: error.code, fields: error.options.fields, details: error.options.details };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('newOrderFields', () => {
  it('trims, keeps the item order and defaults COD to zero', () => {
    const fields = newOrderFields(body());
    expect(fields.recipient).toEqual({
      name: 'سارة',
      phone: '+966500000001',
      altPhone: null,
      language: null,
    });
    expect(fields.items).toEqual([
      {
        nameAr: 'قميص',
        nameEn: 'Shirt',
        sku: null,
        quantity: 2,
        direction: 'out',
        wmsProductId: null,
        declaredValue: null,
      },
    ]);
    expect(fields.codAmount).toBe(0);
    expect(fields.notes).toBeNull();
    expect(fields.address).toEqual({
      text: 'Olaya St',
      city: 'Riyadh',
      district: null,
      shortCode: null,
      point: null,
    });
  });

  it('allows COD on delivery and exchange only (D-4: 422 cod_not_allowed)', () => {
    const cod = { cod_amount: { amount: 1500 } };
    expect(newOrderFields(body(cod)).codAmount).toBe(1500);
    expect(newOrderFields(body({ ...cod, kind: 'exchange' })).codAmount).toBe(1500);
    for (const kind of ['return_pickup', 'pickup_request']) {
      expect(refusal(() => newOrderFields(body({ ...cod, kind })))).toMatchObject({
        code: 'cod_not_allowed',
        details: { kind, cod_amount: 1500 },
      });
      expect(newOrderFields(body({ kind, cod_amount: { amount: 0 } })).codAmount).toBe(0);
    }
  });

  it('bounds COD at 1,000,000 SAR on a create and an edit (round 1, ruling 5d)', () => {
    expect(newOrderFields(body({ cod_amount: { amount: maxCodAmount } })).codAmount).toBe(
      100_000_000,
    );
    const over = { cod_amount: { amount: maxCodAmount + 1 } };
    const problem = {
      code: 'validation_failed',
      fields: [{ pointer: '/body/cod_amount/amount', code: 'invalid' }],
    };
    expect(refusal(() => newOrderFields(body(over)))).toMatchObject(problem);
    expect(refusal(() => orderPatchFields(over, ['cod_amount'], 'delivery'))).toMatchObject(
      problem,
    );
    expect(orderPatchFields({ cod_amount: { amount: 500 } }, ['cod_amount'], 'delivery')).toEqual({
      codAmount: 500,
    });
  });

  it('sets item directions by kind', () => {
    const items = [
      { name_ar: 'أ', name_en: 'A', quantity: 1, direction: 'out' },
      { name_ar: 'ب', name_en: 'B', quantity: 1, direction: 'in' },
    ];
    expect(
      newOrderFields(body({ kind: 'exchange', items })).items.map((item) => item.direction),
    ).toEqual(['out', 'in']);
    for (const kind of ['return_pickup', 'pickup_request']) {
      expect(newOrderFields(body({ kind, items })).items.map((item) => item.direction)).toEqual([
        'in',
        'in',
      ]);
    }
    expect(refusal(() => newOrderFields(body({ items })))).toMatchObject({
      code: 'validation_failed',
      fields: [{ pointer: '/body/items/1/direction', code: 'invalid' }],
    });
  });

  it('refuses out-of-bound texts, items and quantities, bad phones and a slot', () => {
    const item = { name_ar: 'أ', name_en: 'A', quantity: 1 };
    expect(
      refusal(() =>
        newOrderFields(
          body({
            recipient: { name: '   ', phone: '+99912345678' },
            address: { text: 'line\nbreak', city: 'x'.repeat(121) },
            items: [{ ...item, quantity: 10_000, name_en: 'y'.repeat(201) }],
            slot_id: '0192f100-1111-7222-8333-444455556667',
          }),
        ),
      ).fields,
    ).toEqual([
      { pointer: '/body/recipient/name', code: 'too_short' },
      { pointer: '/body/recipient/phone', code: 'invalid' },
      { pointer: '/body/address/text', code: 'invalid' },
      { pointer: '/body/address/city', code: 'too_long' },
      { pointer: '/body/items/0/quantity', code: 'invalid' },
      { pointer: '/body/items/0/name_en', code: 'too_long' },
      { pointer: '/body/slot_id', code: 'invalid' },
    ]);
    expect(
      refusal(() => newOrderFields(body({ items: Array.from({ length: 201 }, () => item) })))
        .fields,
    ).toEqual([{ pointer: '/body/items', code: 'too_long' }]);
    expect(
      newOrderFields(body({ items: Array.from({ length: 200 }, () => item) })).items,
    ).toHaveLength(200);
    // Two hundred Arabic letters are two hundred code points.
    expect(
      newOrderFields(body({ recipient: { name: 'س'.repeat(200), phone: '+966500000001' } }))
        .recipient.name,
    ).toHaveLength(200);
  });
});
