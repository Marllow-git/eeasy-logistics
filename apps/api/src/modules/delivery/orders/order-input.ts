import type { FieldProblem } from '../../kernel/public/index.js';
import type { ItemDirection, OrderKind } from '../../kernel/public/index.js';
import { ApiException, normalisePhone, oneLineTextProblem } from '../../kernel/public/index.js';

// The rules of `createOrder` beyond the contract's schema (DEL-2 plan 2.3; domain model §3.1,
// §3.2, D-4; data §2.2): one-line names and texts in code points, E.164 phones normalised, at most
// 200 items of 1 to 9999, item directions by kind, COD only on the kinds that carry goods to the
// recipient (`422 cod_not_allowed`), and no `slot_id` until the slots order ships.

/** The body the generated `createOrder` schema hands the handler (contract defaults filled). */
export interface CreateOrderBody {
  readonly kind: OrderKind;
  readonly site_id: string;
  readonly source_ref?: string | undefined;
  readonly recipient: {
    readonly name: string;
    readonly phone: string;
    readonly alternate_phone?: string | undefined;
    readonly preferred_language?: 'ar' | 'en' | undefined;
  };
  readonly address: {
    readonly text: string;
    readonly city: string;
    readonly district?: string | undefined;
    readonly national_address_short_code?: string | undefined;
    readonly point?: { readonly lat: number; readonly lng: number } | undefined;
  };
  readonly items?:
    | readonly {
        readonly name_ar: string;
        readonly name_en: string;
        readonly sku?: string | undefined;
        readonly quantity: number;
        readonly direction: ItemDirection;
        readonly wms_product_id?: string | null | undefined;
        readonly declared_value?: { readonly amount: number } | undefined;
      }[]
    | undefined;
  readonly cod_amount?: { readonly amount: number } | undefined;
  readonly slot_id?: string | undefined;
  readonly notes?: string | undefined;
}

export const maxItems = 200;
export const maxItemQuantity = 9999;
const nameLimit = 200;
const skuLimit = 120;
const addressTextLimit = 500;
const cityLimit = 120;
const districtLimit = 120;
const notesLimit = 1000;
const sourceRefLimit = 120;

export interface OrderItemFields {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly direction: ItemDirection;
  readonly wmsProductId: string | null;
  readonly declaredValue: number | null;
}

export interface OrderAddressFields {
  readonly text: string;
  readonly city: string;
  readonly district: string | null;
  readonly shortCode: string | null;
  /** A point the dispatcher typed or pinned (`pin_source: manual`). */
  readonly point: { readonly lat: number; readonly lng: number } | null;
}

export interface NewOrderFields {
  readonly kind: OrderKind;
  readonly siteId: string;
  readonly sourceRef: string | null;
  readonly recipient: {
    readonly name: string;
    readonly phone: string;
    readonly altPhone: string | null;
    readonly language: 'ar' | 'en' | null;
  };
  readonly address: OrderAddressFields;
  readonly items: readonly OrderItemFields[];
  readonly codAmount: number;
  readonly notes: string | null;
}

/** `delivery` and `exchange` carry goods to the recipient, so only they may collect COD (D-4). */
export const codKinds: ReadonlySet<OrderKind> = new Set(['delivery', 'exchange']);

/** The kinds whose goods only come back to the site: every item is `in` (§3.1, §3.2). */
const inboundKinds: ReadonlySet<OrderKind> = new Set(['return_pickup', 'pickup_request']);

/** A trimmed one-line text of 1 to `limit` code points, or its problem. */
function text(problems: FieldProblem[], pointer: string, value: string, limit: number): string {
  const trimmed = value.trim();
  const problem = oneLineTextProblem(pointer, trimmed, limit);
  if (problem !== undefined) problems.push(problem);
  return trimmed;
}

/** An optional text: absent or blank is null. */
function optionalText(
  problems: FieldProblem[],
  pointer: string,
  value: string | undefined,
  limit: number,
): string | null {
  if (value === undefined || value.trim() === '') return null;
  return text(problems, pointer, value, limit);
}

function phone(problems: FieldProblem[], pointer: string, value: string): string {
  const normalised = normalisePhone(value);
  if (normalised === undefined) problems.push({ pointer, code: 'invalid' });
  return normalised ?? value;
}

type CreateRecipient = CreateOrderBody['recipient'];
type CreateAddress = CreateOrderBody['address'];
type CreateItems = NonNullable<CreateOrderBody['items']>;

function recipientFields(
  problems: FieldProblem[],
  at: string,
  recipient: CreateRecipient,
): NewOrderFields['recipient'] {
  return {
    name: text(problems, `${at}/name`, recipient.name, nameLimit),
    phone: phone(problems, `${at}/phone`, recipient.phone),
    altPhone:
      recipient.alternate_phone === undefined
        ? null
        : phone(problems, `${at}/alternate_phone`, recipient.alternate_phone),
    language: recipient.preferred_language ?? null,
  };
}

function addressFields(
  problems: FieldProblem[],
  at: string,
  address: CreateAddress,
): OrderAddressFields {
  return {
    text: text(problems, `${at}/text`, address.text, addressTextLimit),
    city: text(problems, `${at}/city`, address.city, cityLimit),
    district: optionalText(problems, `${at}/district`, address.district, districtLimit),
    shortCode: address.national_address_short_code ?? null,
    point: address.point === undefined ? null : { lat: address.point.lat, lng: address.point.lng },
  };
}

function itemFieldsOf(
  problems: FieldProblem[],
  at: string,
  kind: OrderKind,
  items: CreateItems,
): OrderItemFields[] {
  if (items.length > maxItems) problems.push({ pointer: at, code: 'too_long' });
  return items.slice(0, maxItems).map((item, index): OrderItemFields => {
    const itemAt = `${at}/${index}`;
    if (item.quantity > maxItemQuantity)
      problems.push({ pointer: `${itemAt}/quantity`, code: 'invalid' });
    let direction: ItemDirection = item.direction;
    if (inboundKinds.has(kind)) direction = 'in';
    else if (kind === 'delivery' && direction === 'in') {
      problems.push({ pointer: `${itemAt}/direction`, code: 'invalid' });
    }
    return {
      nameAr: text(problems, `${itemAt}/name_ar`, item.name_ar, nameLimit),
      nameEn: text(problems, `${itemAt}/name_en`, item.name_en, nameLimit),
      sku: optionalText(problems, `${itemAt}/sku`, item.sku, skuLimit),
      quantity: item.quantity,
      direction,
      wmsProductId: item.wms_product_id ?? null,
      declaredValue: item.declared_value?.amount ?? null,
    };
  });
}

/** Notes may span lines; blank is none. */
function notesOf(problems: FieldProblem[], at: string, value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const notes = value.trim();
  if (Array.from(notes).length > notesLimit) problems.push({ pointer: at, code: 'too_long' });
  return notes;
}

/** `422 cod_not_allowed` for COD on a kind that collects nothing (D-4). */
function assertCodAllowed(kind: OrderKind, codAmount: number): void {
  if (codAmount > 0 && !codKinds.has(kind)) {
    throw new ApiException('cod_not_allowed', { details: { kind, cod_amount: codAmount } });
  }
}

/**
 * The checked fields of a create, or the refusal: `400 validation_failed` with every field problem,
 * else `422 cod_not_allowed` for COD on a kind that collects nothing.
 */
export function newOrderFields(body: CreateOrderBody): NewOrderFields {
  const problems: FieldProblem[] = [];
  const kind = body.kind;
  const recipient = recipientFields(problems, '/body/recipient', body.recipient);
  const address = addressFields(problems, '/body/address', body.address);
  const itemFields = itemFieldsOf(problems, '/body/items', kind, body.items ?? []);
  // No `del_slots` yet: a slot id would be stored unchecked (plan 2.3, 2a).
  if (body.slot_id !== undefined) problems.push({ pointer: '/body/slot_id', code: 'invalid' });
  const notes = notesOf(problems, '/body/notes', body.notes);
  const sourceRef = optionalText(problems, '/body/source_ref', body.source_ref, sourceRefLimit);
  if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });

  const codAmount = body.cod_amount?.amount ?? 0;
  assertCodAllowed(kind, codAmount);
  return {
    kind,
    siteId: body.site_id.toLowerCase(),
    sourceRef,
    recipient,
    address,
    items: itemFields,
    codAmount,
    notes,
  };
}

/** The body the generated `updateOrder` schema hands the handler: every part optional. */
export interface UpdateOrderBody {
  readonly recipient?: CreateRecipient | undefined;
  readonly address?: CreateAddress | undefined;
  readonly items?: CreateItems | undefined;
  readonly cod_amount?: { readonly amount: number } | undefined;
  readonly notes?: string | undefined;
}

/** The checked parts of an edit; a part the client did not send is undefined (plan 2.8). */
export interface OrderPatch {
  readonly recipient?: NewOrderFields['recipient'];
  readonly address?: OrderAddressFields;
  readonly items?: readonly OrderItemFields[];
  readonly codAmount?: number;
  /** Null clears the notes (a blank value). */
  readonly notes?: string | null;
}

/** The parts an edit may name, in the order the audit row and the event list them. */
export const patchKeys = ['recipient', 'address', 'items', 'cod_amount', 'notes'] as const;
export type PatchKey = (typeof patchKeys)[number];

/**
 * `updateOrder`'s parts by the create's rules (plan 2.8), for an order of `kind`: `sent` names the
 * top-level fields the client sent (the generated schema fills defaults, `sentBodyFields`). The
 * item list is replaced whole; an empty list is allowed, as on a create.
 */
export function orderPatchFields(
  body: UpdateOrderBody,
  sent: readonly string[],
  kind: OrderKind,
): OrderPatch {
  const problems: FieldProblem[] = [];
  const has = (key: PatchKey) => sent.includes(key);
  const patch: {
    -readonly [K in keyof OrderPatch]: OrderPatch[K];
  } = {};
  if (has('recipient') && body.recipient !== undefined) {
    patch.recipient = recipientFields(problems, '/body/recipient', body.recipient);
  }
  if (has('address') && body.address !== undefined) {
    patch.address = addressFields(problems, '/body/address', body.address);
  }
  if (has('items') && body.items !== undefined) {
    patch.items = itemFieldsOf(problems, '/body/items', kind, body.items);
  }
  if (has('notes')) patch.notes = notesOf(problems, '/body/notes', body.notes);
  if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
  if (has('cod_amount') && body.cod_amount !== undefined) {
    assertCodAllowed(kind, body.cod_amount.amount);
    patch.codAmount = body.cod_amount.amount;
  }
  return patch;
}
