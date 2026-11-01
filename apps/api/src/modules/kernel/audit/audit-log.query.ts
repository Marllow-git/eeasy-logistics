import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { coreAuditLog } from '../schema/audit-log.js';

// The reads of core_audit_log shared by the tenant and platform repositories (PLAT-7 plan 2.6):
// filters, the keyset cursor on (occurred_at, id) and the order. Repository types only; the
// controllers map the contract's query to these.

export type AuditRow = typeof coreAuditLog.$inferSelect;

/** Sort fields of the three list operations: newest first by default. */
export const auditSorts = ['-occurred_at', 'occurred_at'] as const;
export type AuditSort = (typeof auditSorts)[number];

export interface AuditFilters {
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  /** Inclusive lower bound on `occurred_at` (the contract's `created_from`). */
  readonly from?: string | undefined;
  /** Exclusive upper bound on `occurred_at` (the contract's `created_to`). */
  readonly to?: string | undefined;
}

/** The last row of a page: `occurred_at` as PostgreSQL wrote it (microseconds kept) and `id`. */
export interface AuditKey {
  readonly occurredAt: string;
  readonly id: string;
}

export interface AuditPageQuery {
  readonly filters: AuditFilters;
  readonly sort: AuditSort;
  readonly after: AuditKey | undefined;
  /** Rows to read: the page size plus one, so the caller knows whether a next page exists. */
  readonly limit: number;
}

/** The filter and cursor predicate of a page (without any account predicate). */
export function auditPageCondition(query: AuditPageQuery): SQL | undefined {
  const t = coreAuditLog;
  const { filters, after } = query;
  const parts: (SQL | undefined)[] = [
    filters.targetType === undefined ? undefined : eq(t.targetType, filters.targetType),
    filters.targetId === undefined ? undefined : eq(t.targetId, filters.targetId),
    filters.actorId === undefined ? undefined : eq(t.actorId, filters.actorId),
    filters.action === undefined ? undefined : eq(t.action, filters.action),
    filters.from === undefined ? undefined : gte(t.occurredAt, filters.from),
    filters.to === undefined ? undefined : lt(t.occurredAt, filters.to),
  ];
  if (after !== undefined) {
    const key = sql`(${after.occurredAt}::timestamptz, ${after.id}::uuid)`;
    parts.push(
      query.sort === '-occurred_at'
        ? sql`(${t.occurredAt}, ${t.id}) < ${key}`
        : sql`(${t.occurredAt}, ${t.id}) > ${key}`,
    );
  }
  return and(...parts);
}

/** `occurred_at` then `id` as the tie-breaker (ADR-0029), both in the sort's direction. */
export function auditPageOrder(sort: AuditSort): SQL[] {
  const direction = sort === '-occurred_at' ? desc : asc;
  return [direction(coreAuditLog.occurredAt), direction(coreAuditLog.id)];
}
