import { ApiException } from '../errors/api-exception.js';
import type { AuditFilters, AuditPageQuery, AuditRow, AuditSort } from './audit-log.query.js';
import { auditSorts } from './audit-log.query.js';
import type { CursorCodec } from './cursor.js';

// One page of an audit list (PLAT-7 plan 2.6; ADR-0029): the sort checked against the documented
// list, the cursor decoded against the operation, filters and sort, and the next cursor minted
// from the last row when one more row exists.

export interface AuditPageRequest {
  /** The operation id; a cursor never continues another operation's list. */
  readonly operation: string;
  /** Who reads: `account:<id>` (staff) or `platform:<user id>` (platform); bound into the cursor. */
  readonly principal: string;
  /** The filters as the contract names them, bound into the cursor. */
  readonly filters: Readonly<Record<string, string | undefined>>;
  /** The same filters for the repository. */
  readonly repositoryFilters: AuditFilters;
  readonly sort: string | undefined;
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface AuditPagePlan {
  readonly query: AuditPageQuery;
  /** The page out of the `limit + 1` rows read, and the cursor of the next page or null. */
  page(rows: readonly AuditRow[]): {
    readonly rows: AuditRow[];
    readonly nextCursor: string | null;
  };
}

function isAuditSort(value: string): value is AuditSort {
  return (auditSorts as readonly string[]).includes(value);
}

export function planAuditPage(codec: CursorCodec, request: AuditPageRequest): AuditPagePlan {
  const sort = request.sort ?? '-occurred_at';
  if (!isAuditSort(sort)) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/query/sort', code: 'invalid' }],
    });
  }
  const binding = {
    operation: request.operation,
    principal: request.principal,
    filters: request.filters,
    sort,
  };
  const after = request.cursor === undefined ? undefined : codec.decode(request.cursor, binding);
  const size = request.limit;
  return {
    query: { filters: request.repositoryFilters, sort, after, limit: size + 1 },
    page(rows) {
      const kept = rows.slice(0, size);
      const last = kept.at(-1);
      const nextCursor =
        rows.length > size && last !== undefined
          ? codec.encode({ occurredAt: last.occurredAt, id: last.id }, binding)
          : null;
      return { rows: kept, nextCursor };
    },
  };
}
