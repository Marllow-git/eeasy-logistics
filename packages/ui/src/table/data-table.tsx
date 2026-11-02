'use client';

import { formatNumber } from '@eeasy-logistics/i18n';
import {
  columnVisibilityFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowData,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '../components/button/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/dropdown-menu/dropdown-menu';
import { Skeleton } from '../components/skeleton/skeleton';
import { cn } from '../cn';
import { useLocale, useTranslations } from '../intl';

// The list table of the signed-in groups (web §6.3; ADR-0029; WEB-3 plan 2.4): TanStack Table
// (headless) on our markup, cursor paging by "load more" with the shown count and never a total,
// sorting by the list operation's `sort` field (the page keeps it in the URL), column visibility
// per browser in localStorage under `elx:table:<id>`, rows virtualised above 200, a sticky header,
// and the column order following the document direction (a native table mirrors under `dir`).

/** One column: its header, how a row renders in it and, if sortable, the operation's sort field. */
export interface DataTableColumn<Row extends RowData> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  /** The list operation's sort field; the header then sorts by it (`-` prefix descending). */
  readonly sortField?: string;
  /** Whether the column menu may hide it; the first column always stays. */
  readonly hideable?: boolean;
  readonly className?: string;
}

export type DataTableState = 'loading' | 'error' | 'ready';

export interface DataTableProps<Row extends RowData> {
  /** Stable table id: the localStorage key of its column visibility. */
  readonly id: string;
  /** The table's accessible name (its caption, visually hidden). */
  readonly label: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly state: DataTableState;
  /** The current sort as the operation spells it (`name`, `-created_at`). */
  readonly sort?: string;
  readonly onSortChange?: (sort: string) => void;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: () => void;
  /** Opens a row (Enter on a focused row, or a click on it). */
  readonly onRowOpen?: (row: Row) => void;
  /** Controls at the end of each row (menus, buttons). */
  readonly rowActions?: (row: Row) => ReactNode;
  /** Filters and actions above the table. */
  readonly toolbar?: ReactNode;
  /** What an empty list shows (the filtered and the first-time empty state differ per page). */
  readonly empty?: ReactNode;
  /** What a failed load shows (an `ErrorState` with retry). */
  readonly error?: ReactNode;
}

/** Above this many rows the body is virtualised (web §6.3). */
export const virtualisationThreshold = 200;
const rowHeight = 48;
const features = tableFeatures({ columnVisibilityFeature });

/** The next sort when a header is pressed: ascending first, then it toggles. */
export function nextSort(current: string | undefined, field: string): string {
  return current === field ? `-${field}` : field;
}

function sortOf(current: string | undefined, field: string): 'ascending' | 'descending' | 'none' {
  if (current === field) return 'ascending';
  if (current === `-${field}`) return 'descending';
  return 'none';
}

const storageKey = (id: string) => `elx:table:${id}`;
const visibilityListeners = new Set<() => void>();
const emptyVisibility = '{}';

function readVisibility(id: string): string {
  try {
    return window.localStorage.getItem(storageKey(id)) ?? emptyVisibility;
  } catch {
    return emptyVisibility;
  }
}

/** Column visibility of table `id`, kept per browser; read after hydration (server: all shown). */
function useColumnVisibility(
  id: string,
): [ColumnVisibilityState, (next: ColumnVisibilityState) => void] {
  const raw = useSyncExternalStore(
    (listener) => {
      visibilityListeners.add(listener);
      window.addEventListener('storage', listener);
      return () => {
        visibilityListeners.delete(listener);
        window.removeEventListener('storage', listener);
      };
    },
    () => readVisibility(id),
    () => emptyVisibility,
  );
  const visibility = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as ColumnVisibilityState) : {};
    } catch {
      return {};
    }
  }, [raw]);
  const set = useCallback(
    (next: ColumnVisibilityState) => {
      try {
        window.localStorage.setItem(storageKey(id), JSON.stringify(next));
      } catch {
        // Private mode or a full store: the choice lasts for the page only.
      }
      for (const listener of visibilityListeners) listener();
    },
    [id],
  );
  return [visibility, set];
}

export function DataTable<Row extends RowData>({
  id,
  label,
  columns,
  rows,
  rowKey,
  state,
  sort,
  onSortChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRowOpen,
  rowActions,
  toolbar,
  empty,
  error,
}: DataTableProps<Row>) {
  const t = useTranslations('common.table');
  const locale = useLocale();
  const [visibility, setVisibility] = useColumnVisibility(id);

  const definitions = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      columns.map((column, index) => ({
        id: column.id,
        header: column.header,
        enableHiding: index > 0 && column.hideable !== false,
        cell: (context) => column.cell(context.row.original),
      })),
    [columns],
  );
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features,
    columns: definitions,
    data,
    getRowId: (row) => rowKey(row),
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: (updater) =>
      setVisibility(typeof updater === 'function' ? updater(visibility) : updater),
  });

  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const visibleColumns = table.getVisibleLeafColumns();
  const tableRows = table.getRowModel().rows;
  const virtual = tableRows.length > virtualisationThreshold;
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? tableRows.length : 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => tableRows[index]?.id ?? index,
    overscan: 10,
  });
  const span = visibleColumns.length + (rowActions ? 1 : 0);

  const items = virtual
    ? virtualizer.getVirtualItems().map((item) => ({ row: tableRows[item.index]!, item }))
    : tableRows.map((row) => ({ row, item: undefined }));
  const before = virtual ? (virtualizer.getVirtualItems()[0]?.start ?? 0) : 0;
  const after = virtual
    ? virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0)
    : 0;

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) onRowOpen?.(row);
  };
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">{toolbar}</div>
        {hideable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Columns3 aria-hidden />
                {t('columns')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t('columns')}</DropdownMenuLabel>
              {hideable.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(on) => column.toggleVisibility(on)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {byId.get(column.id)?.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div
        ref={scroller}
        className={cn(
          'overflow-auto rounded-lg border border-border',
          virtual ? 'max-h-[70vh]' : undefined,
        )}
      >
        <table className="w-full border-collapse text-sm" aria-busy={state === 'loading'}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {visibleColumns.map((column) => {
                const definition = byId.get(column.id);
                const field = definition?.sortField;
                const direction = field === undefined ? undefined : sortOf(sort, field);
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={direction}
                    className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-2 text-start font-semibold whitespace-nowrap text-foreground"
                  >
                    {field !== undefined && onSortChange ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm hover:underline"
                        onClick={() => onSortChange(nextSort(sort, field))}
                      >
                        {definition?.header}
                        {direction === 'ascending' ? (
                          <ArrowUp aria-hidden className="size-3.5" />
                        ) : direction === 'descending' ? (
                          <ArrowDown aria-hidden className="size-3.5" />
                        ) : (
                          <ArrowUpDown aria-hidden className="size-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      definition?.header
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-2 text-end font-semibold"
                >
                  <span className="sr-only">{t('actions')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {state === 'loading'
              ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={index} className="border-b border-border last:border-b-0">
                    {Array.from({ length: span }, (__, cell) => (
                      <td key={cell} className="px-3 py-3">
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {state === 'ready' && before > 0 ? <tr aria-hidden style={{ height: before }} /> : null}
            {state === 'ready'
              ? items.map(({ row, item }) => (
                  <tr
                    key={row.id}
                    data-index={item?.index}
                    ref={item ? virtualizer.measureElement : undefined}
                    tabIndex={onRowOpen ? 0 : undefined}
                    onKeyDown={onRowOpen ? (event) => onRowKey(event, row.original) : undefined}
                    onClick={onRowOpen ? () => onRowOpen(row.original) : undefined}
                    className={cn(
                      'border-b border-border last:border-b-0',
                      onRowOpen
                        ? 'cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                        : undefined,
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn('px-3 py-3 align-top', byId.get(cell.column.id)?.className)}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                    {rowActions ? (
                      <td
                        className="px-3 py-2 text-end"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {rowActions(row.original)}
                      </td>
                    ) : null}
                  </tr>
                ))
              : null}
            {state === 'ready' && after > 0 ? <tr aria-hidden style={{ height: after }} /> : null}
          </tbody>
        </table>
        {state === 'ready' && rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            {empty ?? <p className="text-sm text-muted-foreground">{t('empty')}</p>}
          </div>
        ) : null}
        {state === 'error' ? <div className="px-4 py-6">{error}</div> : null}
      </div>

      {state === 'ready' && rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted-foreground">
            {t('shown', { count: rows.length, value: formatNumber(locale, rows.length) })}
          </p>
          {hasMore && onLoadMore ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              aria-busy={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? t('loading_more') : t('load_more')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
