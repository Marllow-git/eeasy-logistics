import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import type { ListPageRequest, ListSorts } from './list-page.js';
import {
  CursorCodec,
  containsPattern,
  cursorHmacKey,
  enumListFilter,
  keysetSlice,
  planListPage,
  presentPage,
  textQuery,
} from './list-page.js';

// The kernel's list page helper (PLAT-12 plan 2.4, 2.14; ADR-0029): sort fields, cursor binding,
// page size plus one, the status filter.

const codec = new CursorCodec(cursorHmacKey('a signing key of the test, long enough to derive'));
const sorts: ListSorts<'created_at' | 'name_ar' | 'status'> = {
  fields: { created_at: 'timestamp', name_ar: 'text', status: 'text' },
  default: '-created_at',
};
const id = (n: number) => `0193a5c4-7e1f-7c3a-9b2d-${String(n).padStart(12, '0')}`;
const request = (
  overrides: Partial<ListPageRequest<'created_at' | 'name_ar' | 'status'>> = {},
): ListPageRequest<'created_at' | 'name_ar' | 'status'> => ({
  operation: 'listSites',
  reader: 'account:0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
  filters: { status: 'active' },
  sorts,
  sort: undefined,
  cursor: undefined,
  limit: 2,
  ...overrides,
});

/** The `details.fields` of the `validation_failed` `fn` throws. */
function refusal(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiException) return [error.code, error.options.fields];
    throw error;
  }
  throw new Error('no refusal');
}

const rows = [
  { id: id(1), at: '2026-11-02T10:00:03.000Z' },
  { id: id(2), at: '2026-11-02T10:00:02.000Z' },
  { id: id(3), at: '2026-11-02T10:00:01.000Z' },
];
const keyOf = (row: (typeof rows)[number]) => ({ value: row.at, id: row.id });

describe('planListPage', () => {
  it('takes the default sort, reads one row more than the page and mints the next cursor', () => {
    const plan = planListPage(codec, request());
    expect(plan.sort).toEqual({ field: 'created_at', descending: true, kind: 'timestamp' });
    expect(plan.after).toBeUndefined();
    expect(plan.limit).toBe(3);
    const page = plan.page(rows, keyOf);
    expect(page.rows.map((row) => row.id)).toEqual([id(1), id(2)]);
    expect(page.nextCursor).not.toBeNull();
    const next = planListPage(codec, request({ cursor: page.nextCursor ?? '' }));
    expect(next.after).toEqual({ value: rows[1]?.at, id: id(2) });
  });

  it('answers no cursor on the last page', () => {
    const page = planListPage(codec, request()).page(rows.slice(0, 2), keyOf);
    expect(page.nextCursor).toBeNull();
    expect(presentPage(page, (row) => row.id)).toEqual({ data: [id(1), id(2)], next_cursor: null });
  });

  it('reads an ascending sort and refuses a field outside the documented list', () => {
    expect(planListPage(codec, request({ sort: 'name_ar' })).sort).toEqual({
      field: 'name_ar',
      descending: false,
      kind: 'text',
    });
    for (const sort of ['-updated_at', 'name', '--created_at', '']) {
      expect(refusal(() => planListPage(codec, request({ sort })))).toEqual([
        'validation_failed',
        [{ pointer: '/query/sort', code: 'invalid' }],
      ]);
    }
  });

  it('binds the cursor to the operation, the reader, the filters and the sort, not the limit', () => {
    const cursor = planListPage(codec, request()).page(rows, keyOf).nextCursor ?? '';
    const invalid = ['validation_failed', [{ pointer: '/query/cursor', code: 'invalid' }]];
    for (const other of [
      request({ cursor, operation: 'listMembers' }),
      request({ cursor, reader: 'account:0193a5c4-7e1f-7c3a-9b2d-000000000099' }),
      request({ cursor, filters: { status: 'inactive' } }),
      request({ cursor, filters: {} }),
      request({ cursor, sort: 'created_at' }),
    ]) {
      expect(refusal(() => planListPage(codec, other))).toEqual(invalid);
    }
    expect(planListPage(codec, request({ cursor, limit: 50 })).after?.id).toBe(id(2));
    const [text, signature] = cursor.split('.');
    expect(
      refusal(() => planListPage(codec, request({ cursor: `${text}.${signature?.slice(1)}A` }))),
    ).toEqual(invalid);
  });

  it('refuses an expired cursor and a time key that is not a time', () => {
    const past = new CursorCodec(
      cursorHmacKey('a signing key of the test, long enough to derive'),
      () => Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    );
    const binding = {
      operation: 'listSites',
      principal: 'account:0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
      filters: { status: 'active' },
      sort: '-created_at',
    };
    const expired = past.encode({ value: '2026-11-02T10:00:00.000Z', id: id(1) }, binding);
    const notATime = codec.encode({ value: 'Olaya', id: id(1) }, binding);
    for (const cursor of [expired, notATime]) {
      expect(refusal(() => planListPage(codec, request({ cursor })))).toEqual([
        'validation_failed',
        [{ pointer: '/query/cursor', code: 'invalid' }],
      ]);
    }
    // PostgreSQL's text form with microseconds (the audit log's key) is a time too.
    const audit = codec.encode({ occurredAt: '2026-11-02 10:00:00.123456+00', id: id(1) }, binding);
    expect(planListPage(codec, request({ cursor: audit })).after?.value).toBe(
      '2026-11-02 10:00:00.123456+00',
    );
  });
});

describe('enumListFilter', () => {
  const statuses = ['active', 'inactive'] as const;

  it('reads one value or a comma list', () => {
    expect(enumListFilter(undefined, statuses, '/query/status')).toBeUndefined();
    expect(enumListFilter('active', statuses, '/query/status')).toEqual(['active']);
    expect(enumListFilter('inactive,active,active', statuses, '/query/status')).toEqual([
      'inactive',
      'active',
    ]);
  });

  it('refuses an unknown or empty item', () => {
    for (const raw of ['closed', 'active,', '', 'Active']) {
      expect(refusal(() => enumListFilter(raw, statuses, '/query/status'))).toEqual([
        'validation_failed',
        [{ pointer: '/query/status', code: 'invalid' }],
      ]);
    }
  });
});

describe('the q filter (PLAT-12 leg 2)', () => {
  it('trims the text and reads a blank one as no filter', () => {
    expect(textQuery(undefined)).toBeUndefined();
    expect(textQuery('   ')).toBeUndefined();
    expect(textQuery('  Sara ')).toBe('Sara');
  });

  it('escapes the LIKE wildcards and the escape itself, so the text matches literally', () => {
    expect(containsPattern('sara')).toBe('%sara%');
    expect(containsPattern('50%_off\\x')).toBe('%50\\%\\_off\\\\x%');
  });
});

describe('keysetSlice', () => {
  const people = [
    { id: id(3), name: 'Sara' },
    { id: id(1), name: 'Ali' },
    { id: id(2), name: 'Sara' },
    { id: id(4), name: 'سارة' },
  ];
  const nameKey = (row: (typeof people)[number]) => ({ value: row.name, id: row.id });
  const sort = { field: 'name', descending: false, kind: 'text' as const };

  it('orders by the value then the id, in the sort direction, and keeps the page plus one', () => {
    const ascending = keysetSlice({ sort, after: undefined, limit: 3 }, people, nameKey);
    expect(ascending.map((row) => row.id)).toEqual([id(1), id(2), id(3)]);
    const descending = keysetSlice(
      { sort: { ...sort, descending: true }, after: undefined, limit: 10 },
      people,
      nameKey,
    );
    expect(descending.map((row) => row.id)).toEqual([id(4), id(3), id(2), id(1)]);
  });

  it('continues strictly after the cursor key, ties broken by id', () => {
    const after = { value: 'Sara', id: id(2) };
    const next = keysetSlice({ sort, after, limit: 10 }, people, nameKey);
    expect(next.map((row) => row.id)).toEqual([id(3), id(4)]);
    const back = keysetSlice(
      { sort: { ...sort, descending: true }, after, limit: 10 },
      people,
      nameKey,
    );
    expect(back.map((row) => row.id)).toEqual([id(1)]);
  });
});
