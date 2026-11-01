import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import type { OutboxKind, OutboxStatus } from '../schema/outbox.js';
import { coreOutbox } from '../schema/outbox.js';

// The reads of `platformListOutbox` shared by the tenant (door) and platform repositories (PLAT-8
// plan 2.7): filters, the keyset and the order. Rows are ordered by `id`, a UUIDv7 minted by the
// writer at insert, so id order is creation order and a total order (the contract's sort names
// `created_at`; `created_at` itself is a transaction time several rows share).

export type OutboxRecord = typeof coreOutbox.$inferSelect;

/** A row without the payload: what a list without the door reads (never the payload). */
export type OutboxMetadata = Omit<OutboxRecord, 'payload'>;

/** The sort values the list accepts: newest first by default. */
export const outboxSorts = ['-created_at', 'created_at'] as const;
export type OutboxSort = (typeof outboxSorts)[number];

export interface OutboxListFilters {
  readonly statuses?: readonly OutboxStatus[] | undefined;
  readonly kind?: OutboxKind | undefined;
  readonly type?: string | undefined;
  readonly aggregateId?: string | undefined;
  /** Inclusive lower bound on `created_at`. */
  readonly from?: string | undefined;
  /** Exclusive upper bound on `created_at`. */
  readonly to?: string | undefined;
}

export interface OutboxPageQuery {
  readonly filters: OutboxListFilters;
  readonly sort: OutboxSort;
  /** The id of the last row of the previous page. */
  readonly afterId: string | undefined;
  /** Rows to read: the page size plus one. */
  readonly limit: number;
}

/** The filter and keyset predicate of a page (without any account predicate). */
export function outboxPageCondition(query: OutboxPageQuery): SQL | undefined {
  const t = coreOutbox;
  const { filters, afterId } = query;
  return and(
    filters.statuses === undefined ? undefined : inArray(t.status, [...filters.statuses]),
    filters.kind === undefined ? undefined : eq(t.kind, filters.kind),
    filters.type === undefined ? undefined : eq(t.type, filters.type),
    filters.aggregateId === undefined ? undefined : eq(t.aggregateId, filters.aggregateId),
    filters.from === undefined ? undefined : gte(t.createdAt, new Date(filters.from)),
    filters.to === undefined ? undefined : lt(t.createdAt, new Date(filters.to)),
    afterId === undefined
      ? undefined
      : query.sort === '-created_at'
        ? lt(t.id, afterId)
        : gt(t.id, afterId),
  );
}

export function outboxPageOrder(sort: OutboxSort): SQL[] {
  return [sort === '-created_at' ? desc(coreOutbox.id) : asc(coreOutbox.id)];
}
