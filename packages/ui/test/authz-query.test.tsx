import { ApiError } from '@eeasy-logistics/contracts/http';
import { messages } from '@eeasy-logistics/i18n';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type * as NextNavigation from 'next/navigation';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Can, useCan } from '../src/authz/can';
import { Button } from '../src/components/button/button';
import {
  QueryProvider,
  isStaleSessionRefusal,
  shouldRetry,
  staleTimes,
} from '../src/query/query-provider';
import { SessionProvider, sessionNavigation, useSignOut } from '../src/session/session-provider';
import { directions, renderIn } from './render';

// WEB-3 plan 2.1, 2.2: `Can` and `useCan` over the session's permissions, and the query provider
// (data-class defaults, a stale-session refusal re-reads the session, sign-out clears the cache),
// in both reading directions.

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => router,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  router.refresh.mockReset();
});

const me = {
  user: { name: 'Huda', email: 'huda@example.test' },
  account: { name: 'Riyadh Fresh' },
  permissions: ['core.account.read'],
};

const steps = () => ({
  password: () => Promise.resolve({ kind: 'done' as const }),
  code: () => Promise.resolve({ kind: 'done' as const }),
});

function inSession(ui: React.ReactNode) {
  return (
    <SessionProvider me={me} surface="staff" reauthentication={steps}>
      {ui}
    </SessionProvider>
  );
}

const refusal = (status: number, code: string) =>
  new ApiError({ status, code: code as never, message: '', headers: new Headers() });

function CanRead() {
  return <output>{String(useCan('core.account.read'))}</output>;
}

describe.each(directions)('Can in $locale ($dir)', ({ locale, dir }) => {
  const reason = messages[locale].common.authz.not_permitted;

  it('renders the control when the session holds the permission', () => {
    renderIn(
      locale,
      inSession(
        <Can permission="core.account.read">
          <Button>Save</Button>
        </Can>,
      ),
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.documentElement.dir).toBe(dir);
  });

  it('hides the control by default when the permission is missing', () => {
    renderIn(
      locale,
      inSession(
        <Can permission="core.account.manage">
          <Button>Save</Button>
        </Can>,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('disables the control with the reason as its description and a focusable tooltip', async () => {
    renderIn(
      locale,
      inSession(
        <Can permission="core.account.manage" fallback="disabled">
          <Button>Save</Button>
        </Can>,
      ),
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    const described = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe(reason);
    const wrapper = button.closest('[data-disabled-reason]') as HTMLElement;
    expect(wrapper.tabIndex).toBe(0);
    act(() => wrapper.focus());
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(reason));
  });

  it('takes a specific reason instead of the generic line', () => {
    renderIn(
      locale,
      inSession(
        <Can permission="core.account.manage" fallback="disabled" reason="Owners only">
          <Button>Save</Button>
        </Can>,
      ),
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Owners only',
    );
  });

  it('useCan answers from the session', () => {
    renderIn(locale, inSession(<CanRead />));
    expect(screen.getByRole('status').textContent).toBe('true');
  });
});

describe('query defaults', () => {
  it('never retries a 4xx and retries other failures twice', () => {
    expect(shouldRetry(0, refusal(404, 'not_found'))).toBe(false);
    expect(shouldRetry(0, refusal(429, 'rate_limited'))).toBe(false);
    expect(shouldRetry(0, refusal(503, 'internal_error'))).toBe(true);
    expect(shouldRetry(1, new TypeError('network'))).toBe(true);
    expect(shouldRetry(2, new TypeError('network'))).toBe(false);
  });

  it('treats forbidden and feature_not_enabled as a stale session, nothing else', () => {
    expect(isStaleSessionRefusal(refusal(403, 'forbidden'))).toBe(true);
    expect(isStaleSessionRefusal(refusal(403, 'feature_not_enabled'))).toBe(true);
    expect(isStaleSessionRefusal(refusal(403, 'separation_of_duties'))).toBe(false);
    expect(isStaleSessionRefusal(refusal(404, 'not_found'))).toBe(false);
  });

  it('keeps the data classes of web §2.4', () => {
    expect(staleTimes).toEqual({ session: 300_000, reference: 300_000, list: 30_000 });
  });
});

function Refused({ fn }: { fn: () => Promise<unknown> }) {
  const query = useQuery({ queryKey: ['refused'], queryFn: fn });
  return <output>{query.status}</output>;
}

function Capture({ onClient }: { onClient: (client: QueryClient) => void }) {
  const client = useQueryClient();
  useEffect(() => {
    onClient(client);
  }, [client, onClient]);
  const signOut = useSignOut();
  return <button onClick={() => void signOut()}>out</button>;
}

describe.each(directions)('QueryProvider in $locale ($dir)', ({ locale }) => {
  it('a 403 forbidden re-reads the session once, without retrying the query', async () => {
    const fn = vi.fn(() => Promise.reject(refusal(403, 'forbidden')));
    renderIn(locale, inSession(<QueryProvider>{<Refused fn={fn} />}</QueryProvider>));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('error'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a 404 neither retries nor re-reads the session', async () => {
    const fn = vi.fn(() => Promise.reject(refusal(404, 'not_found')));
    renderIn(locale, inSession(<QueryProvider>{<Refused fn={fn} />}</QueryProvider>));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('error'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('sign-out clears the query cache before the page leaves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    let captured: QueryClient | undefined;
    renderIn(
      locale,
      inSession(
        <QueryProvider>
          <Capture onClient={(client) => (captured = client)} />
        </QueryProvider>,
      ),
    );
    act(() => {
      captured!.setQueryData(['/v1/staff/account/settings'], { data: { max_attempts: 4 } });
    });
    expect(captured!.getQueryCache().getAll()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/signed-out'));
    expect(captured!.getQueryCache().getAll()).toHaveLength(0);
  });
});
