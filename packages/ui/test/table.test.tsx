import { messages } from '@eeasy-logistics/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as NextNavigation from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCursorList } from '../src/table/cursor-list';
import {
  DataTable,
  nextSort,
  virtualisationThreshold,
  type DataTableColumn,
} from '../src/table/data-table';
import { listQuery, useListParams } from '../src/table/list-params';
import { arabicIndicDigits, directions, renderIn, wrapIn } from './render';

// WEB-3 plan 2.4: `DataTable` (cursor "load more" with the shown count, sort by header, column
// visibility in localStorage, virtualised rows above 200, keyboard rows), the URL-bound list
// parameters and the cursor list, in both reading directions.

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useSearchParams: () => navigation.search,
  usePathname: () => '/settings/members',
  useRouter: () => ({ replace: navigation.replace }),
}));

beforeEach(() => {
  window.localStorage.clear();
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

interface Member {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

const columns: DataTableColumn<Member>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortField: 'name' },
  { id: 'status', header: 'Status', cell: (row) => row.status, sortField: 'status' },
  { id: 'joined', header: 'Joined', cell: () => '2026-11-02' },
];
const members = (count: number): Member[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    name: `Member ${index}`,
    status: 'active',
  }));

describe('table helpers', () => {
  it('sorts ascending first, then toggles', () => {
    expect(nextSort(undefined, 'name')).toBe('name');
    expect(nextSort('name', 'name')).toBe('-name');
    expect(nextSort('-name', 'name')).toBe('name');
    expect(nextSort('-created_at', 'name')).toBe('name');
  });

  it('builds a stable URL query without empty values', () => {
    expect(listQuery({ status: 'active', q: '', sort: '-name', site_id: undefined })).toBe(
      '?sort=-name&status=active',
    );
    expect(listQuery({})).toBe('');
  });
});

describe.each(directions)('DataTable in $locale ($dir)', ({ locale, dir }) => {
  const t = messages[locale].common.table;

  it('renders the header row in the reading direction, with a caption and the shown count', () => {
    renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(3)}
        rowKey={(row) => row.id}
        state="ready"
        hasMore
        onLoadMore={() => {}}
      />,
    );
    const table = screen.getByRole('table', { name: 'Members' });
    expect(table.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir).toBe(dir);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Name', 'Status', 'Joined']);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const shown = screen.getByRole('status').textContent ?? '';
    expect(shown).toContain('3');
    expect(shown).not.toMatch(arabicIndicDigits);
    expect(screen.getByRole('button', { name: t.load_more })).toBeTruthy();
  });

  it('loads more on request and hides the control at the end of the list', () => {
    const more = vi.fn();
    const { rerender } = renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(2)}
        rowKey={(row) => row.id}
        state="ready"
        hasMore
        onLoadMore={more}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t.load_more }));
    expect(more).toHaveBeenCalledTimes(1);
    rerender(
      wrapIn(
        locale,
        <DataTable
          id="members"
          label="Members"
          columns={columns}
          rows={members(2)}
          rowKey={(row) => row.id}
          state="ready"
          hasMore={false}
          onLoadMore={more}
        />,
      ),
    );
    expect(screen.queryByRole('button', { name: t.load_more })).toBeNull();
  });

  it('sorts by a header with aria-sort, ascending first', () => {
    const sort = vi.fn();
    renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(2)}
        rowKey={(row) => row.id}
        state="ready"
        sort="-name"
        onSortChange={sort}
      />,
    );
    const [name, status, joined] = screen.getAllByRole('columnheader');
    expect(name!.getAttribute('aria-sort')).toBe('descending');
    expect(status!.getAttribute('aria-sort')).toBe('none');
    expect(joined!.hasAttribute('aria-sort')).toBe(false);
    fireEvent.click(within(name!).getByRole('button'));
    fireEvent.click(within(status!).getByRole('button'));
    expect(sort.mock.calls).toEqual([['name'], ['status']]);
  });

  it('shows skeleton rows while loading, the empty state, and the error state', () => {
    const { rerender } = renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        state="loading"
      />,
    );
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
    rerender(
      wrapIn(
        locale,
        <DataTable
          id="members"
          label="Members"
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          state="ready"
          empty={<p>No members yet</p>}
        />,
      ),
    );
    expect(screen.getByText('No members yet')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    rerender(
      wrapIn(
        locale,
        <DataTable
          id="members"
          label="Members"
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          state="error"
          error={<p>Could not load</p>}
        />,
      ),
    );
    expect(screen.getByText('Could not load')).toBeTruthy();
  });

  it('opens a focused row with Enter and keeps row actions apart', () => {
    const open = vi.fn();
    const action = vi.fn();
    renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(2)}
        rowKey={(row) => row.id}
        state="ready"
        onRowOpen={open}
        rowActions={(row) => <button onClick={() => void action(row.id)}>Act {row.id}</button>}
      />,
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]!.tabIndex).toBe(0);
    rows[1]!.focus();
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Act m0' }));
    expect(action).toHaveBeenCalledWith('m0');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('hides a column from the menu and remembers it in localStorage', async () => {
    renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(1)}
        rowKey={(row) => row.id}
        state="ready"
      />,
    );
    const trigger = screen.getByRole('button', { name: t.columns });
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    const status = await screen.findByRole('menuitemcheckbox', { name: 'Status' });
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Name' })).toBeNull();
    fireEvent.click(status);
    await waitFor(() =>
      expect(
        screen.getAllByRole('columnheader', { hidden: true }).map((cell) => cell.textContent),
      ).toEqual(['Name', 'Joined']),
    );
    expect(JSON.parse(window.localStorage.getItem('elx:table:members') ?? '{}')).toEqual({
      status: false,
    });
  });

  it(`virtualises above ${virtualisationThreshold} rows`, () => {
    renderIn(
      locale,
      <DataTable
        id="members"
        label="Members"
        columns={columns}
        rows={members(virtualisationThreshold + 50)}
        rowKey={(row) => row.id}
        state="ready"
      />,
    );
    const body = within(screen.getByRole('table')).getAllByRole('row');
    expect(body.length).toBeLessThan(virtualisationThreshold);
    expect(screen.getByRole('status').textContent).toContain(String(virtualisationThreshold + 50));
  });
});

function Params() {
  const { params, set } = useListParams(['status', 'q', 'sort'] as const);
  return (
    <>
      <output>{JSON.stringify(params)}</output>
      <button onClick={() => set({ status: 'invited', q: '' })}>filter</button>
    </>
  );
}

describe('useListParams', () => {
  it('reads the keys from the URL and replaces the entry, keeping other parameters', () => {
    navigation.search = new URLSearchParams('status=active&q=huda&tab=x');
    render(<Params />);
    expect(JSON.parse(screen.getByRole('status').textContent)).toEqual({
      status: 'active',
      q: 'huda',
    });
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    expect(navigation.replace).toHaveBeenCalledWith('/settings/members?status=invited&tab=x', {
      scroll: false,
    });
  });
});

function List({
  fetchPage,
}: {
  fetchPage: Parameters<typeof useCursorList<Member>>[0]['fetchPage'];
}) {
  const list = useCursorList<Member>({ queryKey: ['/v1/staff/members', {}], fetchPage });
  return (
    <>
      <output>{list.rows.map((row) => row.id).join(',')}</output>
      <span>{list.state}</span>
      {list.hasMore ? <button onClick={list.loadMore}>more</button> : null}
    </>
  );
}

describe('useCursorList', () => {
  it('pages by next_cursor and stops at the last page', async () => {
    const fetchPage = vi.fn((cursor: string | undefined) =>
      Promise.resolve(
        cursor === undefined
          ? { data: members(2), next_cursor: 'c1' }
          : { data: [{ id: 'm9', name: 'Last', status: 'active' }], next_cursor: null },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <List fetchPage={fetchPage} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('m0,m1'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'more' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('m0,m1,m9'));
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual([undefined, 'c1']);
  });
});
