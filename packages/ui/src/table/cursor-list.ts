'use client';

import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { staleTimes } from '../query/query-provider';
import type { RowData } from '@tanstack/react-table';
import type { DataTableState } from './data-table';

// A cursor-paged list (ADR-0029; web §2.4 "Lists"; WEB-3 plan 2.4): pages of a list operation
// fetched by `next_cursor` behind "load more", 30 s fresh, the previous rows kept while a filter
// change loads. The query key is the operation's own key built from the URL parameters, so the
// list re-reads when a filter changes and a mutation can invalidate it by that key's prefix.

/** One page as every list operation answers it (components.yaml `Page`). */
export interface CursorPage<Row> {
  readonly data?: readonly Row[];
  readonly next_cursor: string | null;
}

export interface CursorList<Row extends RowData> {
  readonly rows: readonly Row[];
  readonly state: DataTableState;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  readonly error: unknown;
  readonly retry: () => void;
}

export function useCursorList<Row extends RowData>({
  queryKey,
  fetchPage,
  enabled = true,
}: {
  /** The list operation's query key with the current parameters (`getListMembersQueryKey`). */
  queryKey: QueryKey;
  /** One page from `cursor` (none for the first). */
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<Row>>;
  enabled?: boolean;
}): CursorList<Row> {
  const query = useInfiniteQuery({
    queryKey: [...queryKey, 'cursor-pages'],
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: staleTimes.list,
    placeholderData: keepPreviousData,
    enabled,
  });
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.data ?? []) ?? [],
    [query.data],
  );
  const state: DataTableState =
    query.status === 'pending' ? 'loading' : query.status === 'error' ? 'error' : 'ready';
  return {
    rows,
    state,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    error: query.error,
    retry: () => void query.refetch(),
  };
}
