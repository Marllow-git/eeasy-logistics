import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { asc, desc, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { ApiException } from '../errors/api-exception.js';
import { canonicalJson } from '../idempotency/request-hash.js';

// Cursor lists (ADR-0029; contracts README §3 "Pagination"; PLAT-7 plan 2.6, generalised by PLAT-12
// plan 2.4). One page of any list: the sort checked against the operation's documented fields
// (`-` prefix descending), the cursor decoded against the operation, the reader, the filters and
// the sort, `limit + 1` rows read, and the next cursor minted from the last row kept when one more
// exists. Keyset on (sort value, id): `id` is the tie-breaker, so the order is total and stable
// under inserts between pages. No counts.
//
// A cursor is base64url of `{ v: 1, k: [sort value, id], f: sha256(binding), exp }`, then `.` and
// an HMAC-SHA256 of that text under a key derived from the signing key (ADR-0029: "signed by the
// API"). Valid 24 hours and only with the same operation, reader, filters and sort; anything else
// is `400 validation_failed` on `/query/cursor`.

export const cursorLifetimeSeconds = 24 * 60 * 60;
export const CURSOR_CODEC = Symbol('CURSOR_CODEC');

/** HKDF-SHA256 of the signing key, info `elx-cursor` (a key of its own, not the idempotency one). */
export function cursorHmacKey(signingKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', signingKey, Buffer.alloc(0), 'elx-cursor', 32));
}

/**
 * What a cursor is bound to: the operation, who reads (adversary I-1 of PLAT-7: `account:<id>` on
 * the staff surface, `platform:<user id>` on the platform surface, whose filters carry
 * `account_id`), its filters and its sort (never the limit).
 */
export interface CursorBinding {
  readonly operation: string;
  readonly principal: string;
  readonly filters: Readonly<Record<string, string | undefined>>;
  readonly sort: string;
}

/** The last row of a page: the value of its sort field as text, and its id. */
export interface PageKey {
  readonly value: string;
  readonly id: string;
}

/** PLAT-7's name for the value of its time-sorted lists (the audit log, the outbox). */
export interface OccurredAtKey {
  readonly occurredAt: string;
  readonly id: string;
}

function bindingHash(binding: CursorBinding): string {
  const filters = Object.fromEntries(
    Object.entries(binding.filters).filter(([, value]) => value !== undefined),
  );
  return createHash('sha256')
    .update(
      canonicalJson({
        operation: binding.operation,
        principal: binding.principal,
        filters,
        sort: binding.sort,
      }),
    )
    .digest('base64url');
}

const invalidCursor = () =>
  new ApiException('validation_failed', {
    fields: [{ pointer: '/query/cursor', code: 'invalid' }],
  });

interface CursorPayload {
  readonly v: 1;
  readonly k: readonly [string, string];
  readonly f: string;
  readonly exp: number;
}

/** The longest sort value a cursor carries (names are at most 120 characters, 2.5). */
const maxKeyLength = 1024;

function isPayload(value: unknown): value is CursorPayload {
  if (value === null || typeof value !== 'object') return false;
  const payload = value as Partial<Record<keyof CursorPayload, unknown>>;
  const key = payload.k;
  return (
    payload.v === 1 &&
    Array.isArray(key) &&
    key.length === 2 &&
    typeof key[0] === 'string' &&
    key[0].length <= maxKeyLength &&
    typeof key[1] === 'string' &&
    isUuid(key[1]) &&
    typeof payload.f === 'string' &&
    typeof payload.exp === 'number' &&
    Number.isInteger(payload.exp)
  );
}

export class CursorCodec {
  /** `key` undefined (no signing key, outside production only): every cursor is refused. */
  constructor(
    private readonly key: Buffer | undefined,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private sign(text: string): Buffer {
    if (this.key === undefined) throw new ApiException('internal_error');
    return createHmac('sha256', this.key).update(text).digest();
  }

  encode(last: PageKey | OccurredAtKey, binding: CursorBinding): string {
    const value = 'value' in last ? last.value : last.occurredAt;
    const payload: CursorPayload = {
      v: 1,
      k: [value, last.id],
      f: bindingHash(binding),
      exp: this.nowSeconds() + cursorLifetimeSeconds,
    };
    const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${text}.${this.sign(text).toString('base64url')}`;
  }

  /** The key a cursor continues after; refuses a forged, foreign, rebound or expired cursor. */
  decode(cursor: string, binding: CursorBinding): PageKey {
    const [text, signature, extra] = cursor.split('.');
    if (text === undefined || signature === undefined || extra !== undefined) throw invalidCursor();
    if (this.key === undefined) throw invalidCursor();
    const expected = this.sign(text);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw invalidCursor();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    } catch {
      throw invalidCursor();
    }
    if (!isPayload(payload)) throw invalidCursor();
    if (payload.f !== bindingHash(binding)) throw invalidCursor();
    if (payload.exp <= this.nowSeconds()) throw invalidCursor();
    return { value: payload.k[0], id: payload.k[1] };
  }
}

/**
 * How a sort field's value is keyed: `timestamp` (PostgreSQL's text form, or an ISO instant) or
 * `text` (compared in the column's collation).
 */
export type SortKind = 'timestamp' | 'text';

/** The documented sort fields of one list operation and its default (`-created_at`). */
export interface ListSorts<F extends string> {
  readonly fields: Readonly<Record<F, SortKind>>;
  readonly default: `-${F}` | F;
}

export interface ListSort<F extends string> {
  readonly field: F;
  readonly descending: boolean;
  readonly kind: SortKind;
}

export interface ListPageRequest<F extends string> {
  /** The operation id; a cursor never continues another operation's list. */
  readonly operation: string;
  /** Who reads: `account:<id>` (staff) or `platform:<user id>` (platform); bound into the cursor. */
  readonly reader: string;
  /** The filters as the contract names them, bound into the cursor. */
  readonly filters: Readonly<Record<string, string | undefined>>;
  readonly sorts: ListSorts<F>;
  readonly sort: string | undefined;
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface ListPagePlan<F extends string> {
  readonly sort: ListSort<F>;
  /** The key the page continues after, or undefined for the first page. */
  readonly after: PageKey | undefined;
  /** Rows to read: the page size plus one, so the plan knows whether a next page exists. */
  readonly limit: number;
  /** The page out of the rows read, and the cursor of the next page or null. */
  page<R>(rows: readonly R[], keyOf: (row: R) => PageKey): ListPage<R>;
}

export interface ListPage<R> {
  readonly rows: R[];
  readonly nextCursor: string | null;
}

/** PostgreSQL's text form of a timestamptz, or an ISO instant (`Date.toISOString()`). */
const timestampValue =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2}){0,2})$/;

export function planListPage<F extends string>(
  codec: CursorCodec,
  request: ListPageRequest<F>,
): ListPagePlan<F> {
  const sortText = request.sort ?? request.sorts.default;
  const descending = sortText.startsWith('-');
  const field = (descending ? sortText.slice(1) : sortText) as F;
  if (!Object.hasOwn(request.sorts.fields, field)) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/query/sort', code: 'invalid' }],
    });
  }
  const sort: ListSort<F> = { field, descending, kind: request.sorts.fields[field] };
  const binding: CursorBinding = {
    operation: request.operation,
    principal: request.reader,
    filters: request.filters,
    sort: sortText,
  };
  let after: PageKey | undefined;
  if (request.cursor !== undefined) {
    after = codec.decode(request.cursor, binding);
    if (sort.kind === 'timestamp' && !timestampValue.test(after.value)) throw invalidCursor();
  }
  const size = request.limit;
  return {
    sort,
    after,
    limit: size + 1,
    page(rows, keyOf) {
      const kept = rows.slice(0, size);
      const last = kept.at(-1);
      const nextCursor =
        rows.length > size && last !== undefined ? codec.encode(keyOf(last), binding) : null;
      return { rows: kept, nextCursor };
    },
  };
}

/** The contract's `Page` of a list: `data` presented row by row, `next_cursor`. */
export function presentPage<R, T>(
  page: ListPage<R>,
  present: (row: R) => T,
): { data: T[]; next_cursor: string | null } {
  return { data: page.rows.map(present), next_cursor: page.nextCursor };
}

/**
 * The keyset predicate after `plan.after` on (`value`, `id`), in the sort's direction; `value` is
 * the SQL the rows are ordered by (a column, or an expression such as a truncated time).
 */
export function keysetAfter(
  plan: Pick<ListPagePlan<string>, 'sort' | 'after'>,
  value: SQL | AnyPgColumn,
  id: AnyPgColumn,
): SQL | undefined {
  const { after } = plan;
  if (after === undefined) return undefined;
  const key =
    plan.sort.kind === 'timestamp'
      ? sql`(${after.value}::timestamptz, ${after.id}::uuid)`
      : sql`(${after.value}::text, ${after.id}::uuid)`;
  return plan.sort.descending ? sql`(${value}, ${id}) < ${key}` : sql`(${value}, ${id}) > ${key}`;
}

/** `value` then `id`, both in the sort's direction (ADR-0029: `id` is the tie-breaker). */
export function keysetOrder(
  plan: Pick<ListPagePlan<string>, 'sort'>,
  value: SQL | AnyPgColumn,
  id: AnyPgColumn,
): SQL[] {
  const direction = plan.sort.descending ? desc : asc;
  return [direction(value), direction(id)];
}

/**
 * A `status`-style filter (contracts `StatusQuery`): one value or a comma list, each from
 * `allowed`; anything else, an empty item included, is `400 validation_failed` at `pointer`.
 */
export function enumListFilter<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  pointer: string,
): readonly T[] | undefined {
  if (raw === undefined) return undefined;
  const values = raw.split(',');
  const known = new Set<string>(allowed);
  if (values.some((value) => !known.has(value))) {
    throw new ApiException('validation_failed', { fields: [{ pointer, code: 'invalid' }] });
  }
  return [...new Set(values)] as T[];
}
