import { messages } from '@eeasy-logistics/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeInput } from '../src/auth/code-input';
import { PasswordField } from '../src/auth/password-field';
import { ReSignInDialog, type Reauthentication } from '../src/auth/re-sign-in-dialog';
import {
  SessionProvider,
  sessionNavigation,
  usePermissions,
  useSession,
  useSessionEndCleanup,
  useSessionFetcher,
  useUnsavedState,
} from '../src/session/session-provider';
import { UserMenu } from '../src/session/user-menu';
import { arabicIndicDigits, directions, renderIn, wrapIn } from './render';

// WEB-2 plan 2.3, 2.8, 2.10: the session provider, the re-sign-in dialog and the two fields it
// uses, in both reading directions.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ControlledPassword({
  autoComplete,
}: {
  autoComplete: 'current-password' | 'new-password';
}) {
  const [value, setValue] = useState('');
  return (
    <PasswordField
      label="Password"
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function ControlledCode({ onComplete }: { onComplete?: (code: string) => void }) {
  const [value, setValue] = useState('');
  return <CodeInput value={value} onChange={setValue} onComplete={onComplete} />;
}

const me = {
  user: { name: 'Huda Al-Qahtani', email: 'huda@example.test' },
  account: { name: 'Riyadh Fresh' },
  permissions: ['core.members.read'],
};

const steps = (outcome: Awaited<ReturnType<Reauthentication['password']>>) => ({
  password: vi.fn(() => Promise.resolve(outcome)),
  code: vi.fn(() => Promise.resolve({ kind: 'done' as const })),
});

describe.each(directions)('auth fields in $locale ($dir)', ({ locale, dir }) => {
  const fields = messages[locale].auth.fields;

  it('PasswordField shows and hides the password with a labelled toggle', () => {
    renderIn(locale, <ControlledPassword autoComplete="current-password" />);
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
    expect(input.getAttribute('dir')).toBe('ltr');
    fireEvent.click(screen.getByRole('button', { name: fields.show_password }));
    expect(input.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: fields.hide_password }));
    expect(input.getAttribute('type')).toBe('password');
    expect(document.documentElement.dir).toBe(dir);
  });

  it('PasswordField lists the length rule live for a new password, in Western digits', () => {
    renderIn(locale, <ControlledPassword autoComplete="new-password" />);
    const input = screen.getByLabelText('Password');
    fireEvent.change(input, { target: { value: 'short' } });
    const rules = document.querySelector('[data-met]')!;
    expect(rules.getAttribute('data-met')).toBe('false');
    expect(rules.textContent).toContain('5');
    expect(rules.textContent).toContain('12');
    expect(rules.textContent).not.toMatch(arabicIndicDigits);
    fireEvent.change(input, { target: { value: 'a long enough passphrase' } });
    expect(rules.getAttribute('data-met')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(rules.id);
  });

  it('PasswordField announces an error and marks the input invalid', () => {
    renderIn(
      locale,
      <PasswordField
        label="Password"
        autoComplete="new-password"
        value=""
        onChange={() => {}}
        error="Breached"
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Breached');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
  });

  it('CodeInput has six labelled numeric cells, left to right in both directions', () => {
    renderIn(locale, <ControlledCode />);
    const group = screen.getByRole('group', { name: fields.code });
    expect(group.getAttribute('dir')).toBe('ltr');
    const cells = screen.getAllByRole('textbox');
    expect(cells).toHaveLength(6);
    expect(cells[0]!.getAttribute('autocomplete')).toBe('one-time-code');
    expect(cells.every((cell) => cell.getAttribute('inputmode') === 'numeric')).toBe(true);
    expect(cells[5]!.getAttribute('aria-label')).toBe(fields.code_digit.replace('{position}', '6'));
  });

  it('CodeInput moves forward as digits are typed, back on Backspace, and completes', () => {
    const onComplete = vi.fn();
    renderIn(locale, <ControlledCode onComplete={onComplete} />);
    const cells = screen.getAllByRole<HTMLInputElement>('textbox');
    fireEvent.change(cells[0]!, { target: { value: '1' } });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.change(cells[1]!, { target: { value: 'x' } });
    expect(cells[1]!.value).toBe('');
    fireEvent.keyDown(cells[1]!, { key: 'Backspace' });
    expect(cells[0]!.value).toBe('');
    expect(document.activeElement).toBe(cells[0]);
    for (const [index, digit] of ['4', '2', '7', '1', '9', '3'].entries()) {
      fireEvent.change(cells[index]!, { target: { value: digit } });
    }
    expect(cells.map((cell) => cell.value).join('')).toBe('427193');
    expect(onComplete).toHaveBeenCalledWith('427193');
    fireEvent.keyDown(cells[5]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells[4]);
  });

  it('CodeInput fills all cells from a pasted code', () => {
    const onComplete = vi.fn();
    renderIn(locale, <ControlledCode onComplete={onComplete} />);
    const cells = screen.getAllByRole<HTMLInputElement>('textbox');
    fireEvent.paste(cells[2]!, { clipboardData: { getData: () => ' 123-456 ' } });
    expect(cells.map((cell) => cell.value).join('')).toBe('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});

describe.each(directions)('ReSignInDialog in $locale ($dir)', ({ locale }) => {
  const session = messages[locale].auth.session;

  it('signs in with the password alone when no factor is asked', async () => {
    const reauth = steps({ kind: 'done' });
    const onSignedIn = vi.fn();
    renderIn(
      locale,
      <ReSignInDialog
        open
        reauthentication={reauth}
        onSignedIn={onSignedIn}
        onDismiss={() => {}}
        onOtherAccount={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: session.dialog_title })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(messages[locale].auth.fields.password), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(reauth.password).toHaveBeenCalledWith('correct horse battery');
  });

  it('asks for the code when the API does, then shows a refusal and signs in on the next code', async () => {
    const code = vi
      .fn<Reauthentication['code']>()
      .mockResolvedValueOnce({ kind: 'error', message: 'Wrong code' })
      .mockResolvedValueOnce({ kind: 'done' });
    const reauth: Reauthentication = {
      password: () => Promise.resolve({ kind: 'code' as const }),
      code,
    };
    const onSignedIn = vi.fn();
    renderIn(
      locale,
      <ReSignInDialog
        open
        reauthentication={reauth}
        onSignedIn={onSignedIn}
        onDismiss={() => {}}
        onOtherAccount={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(messages[locale].auth.fields.password), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    await screen.findByText(session.dialog_code_description);
    const cells = screen.getAllByRole('textbox');
    fireEvent.paste(cells[0]!, { clipboardData: { getData: () => '111111' } });
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong code');
    fireEvent.paste(screen.getAllByRole('textbox')[0]!, {
      clipboardData: { getData: () => '222222' },
    });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(code).toHaveBeenLastCalledWith('222222');
  });

  it('forgets the typed password, the code step and the error when closed and reopened', async () => {
    // Adversary M-1: a dismissed dialog must not reopen at a dead code step or keep the password.
    const password = vi
      .fn<Reauthentication['password']>()
      .mockResolvedValueOnce({ kind: 'error', message: 'Wrong password' })
      .mockResolvedValue({ kind: 'code' });
    const reauth: Reauthentication = { password, code: vi.fn() };
    const dialog = (open: boolean) => (
      <ReSignInDialog
        open={open}
        reauthentication={reauth}
        onSignedIn={() => {}}
        onDismiss={() => {}}
        onOtherAccount={() => {}}
      />
    );
    const view = renderIn(locale, dialog(true));
    const field = () =>
      screen.getByLabelText<HTMLInputElement>(messages[locale].auth.fields.password);
    fireEvent.change(field(), { target: { value: 'first try' } });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong password');
    // Cleared as soon as it was sent.
    expect(field().value).toBe('');
    fireEvent.change(field(), { target: { value: 'typed then dismissed' } });
    view.rerender(wrapIn(locale, dialog(false)));
    view.rerender(wrapIn(locale, dialog(true)));
    expect(field().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    // Reaching the code step, then dismissing, reopens at the password step.
    fireEvent.change(field(), { target: { value: 'second try' } });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    await screen.findByText(session.dialog_code_description);
    view.rerender(wrapIn(locale, dialog(false)));
    view.rerender(wrapIn(locale, dialog(true)));
    expect(screen.queryByText(session.dialog_code_description)).toBeNull();
    expect(screen.getByText(session.dialog_description)).toBeTruthy();
    expect(field().value).toBe('');
  });

  it('offers a full sign-in with another account', () => {
    const onOtherAccount = vi.fn();
    renderIn(
      locale,
      <ReSignInDialog
        open
        reauthentication={steps({ kind: 'done' })}
        onSignedIn={() => {}}
        onDismiss={() => {}}
        onOtherAccount={onOtherAccount}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: session.dialog_other_user }));
    expect(onOtherAccount).toHaveBeenCalledTimes(1);
  });
});

/** A page that calls the API and may hold unsaved state. */
function Page({ dirty }: { dirty: boolean }) {
  const fetcher = useSessionFetcher();
  const session = useSession();
  const { has } = usePermissions();
  const [result, setResult] = useState('');
  useUnsavedState(dirty);
  return (
    <div>
      <p>{session.user?.name}</p>
      <p>{has('core.members.read') ? 'can read' : 'cannot read'}</p>
      <button
        type="button"
        onClick={() => {
          void fetcher('/v1/staff/orders/1', { method: 'PUT', body: '{}' }).then((response) =>
            setResult(String(response.status)),
          );
        }}
      >
        save
      </button>
      <output>{result}</output>
    </div>
  );
}

/** The API: every call 401 token_expired and the refresh refused, until `signedIn`. */
function stubApi() {
  const state = { signedIn: false, keys: [] as (string | null)[] };
  const fetch = vi.fn((input: string, init?: RequestInit) => {
    const url = input;
    const headers = new Headers(init?.headers);
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(
        Response.json({ code: 'token_invalid', message: '' }, { status: 401 }),
      );
    }
    if (url.endsWith('/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
    state.keys.push(headers.get('idempotency-key'));
    return Promise.resolve(
      state.signedIn
        ? Response.json({ ok: true })
        : Response.json({ code: 'token_expired', message: '' }, { status: 401 }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}

describe.each(directions)('SessionProvider in $locale ($dir)', ({ locale }) => {
  const session = messages[locale].auth.session;

  it('gives the page its session and permissions', () => {
    renderIn(
      locale,
      <SessionProvider me={me} surface="staff" reauthentication={() => steps({ kind: 'done' })}>
        <Page dirty={false} />
      </SessionProvider>,
    );
    expect(screen.getByText('Huda Al-Qahtani')).toBeTruthy();
    expect(screen.getByText('can read')).toBeTruthy();
  });

  it('without unsaved state, an ended session goes to sign-in with the page it was on', async () => {
    stubApi();
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    const ended = vi.fn();
    window.history.replaceState(null, '', '/orders?status=open');
    renderIn(
      locale,
      <SessionProvider
        me={me}
        surface="staff"
        reauthentication={() => steps({ kind: 'done' })}
        onSessionEnded={ended}
      >
        <Page dirty={false} />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/sign-in?next=%2Forders%3Fstatus%3Dopen&reason=ended'),
    );
    expect(ended).toHaveBeenCalledWith('refresh_refused');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with unsaved state, it opens the dialog and retries with the same key once signed in', async () => {
    const api = stubApi();
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    const reauth: Reauthentication = {
      password: vi.fn(() => {
        api.state.signedIn = true;
        return Promise.resolve({ kind: 'done' as const });
      }),
      code: vi.fn(),
    };
    renderIn(
      locale,
      <SessionProvider me={me} surface="staff" reauthentication={() => reauth}>
        <Page dirty />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('dialog', { name: session.dialog_title });
    fireEvent.change(screen.getByLabelText(messages[locale].auth.fields.password), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('200'));
    expect(assign).not.toHaveBeenCalled();
    expect(api.state.keys).toHaveLength(2);
    expect(api.state.keys[0]).toBe(api.state.keys[1]);
  });

  it('on the platform surface, asks for the password then the TOTP code with its own line', async () => {
    const api = stubApi();
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    const totpLine = messages[locale].auth.totp.description;
    const totpCode = vi.fn((code: string) => {
      api.state.signedIn = code === '123456';
      return Promise.resolve({ kind: 'done' as const });
    });
    const reauth: Reauthentication = {
      password: vi.fn(() => Promise.resolve({ kind: 'code' as const })),
      code: totpCode,
    };
    renderIn(
      locale,
      <SessionProvider
        me={{ user: me.user, permissions: [] }}
        surface="platform"
        reauthentication={() => reauth}
        codeDescription={totpLine}
      >
        <Page dirty />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('dialog', { name: session.dialog_title });
    expect(api.fetch.mock.calls.some(([url]) => url === '/v1/platform/auth/refresh')).toBe(true);
    fireEvent.change(screen.getByLabelText(messages[locale].auth.fields.password), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    expect(await screen.findByText(totpLine)).toBeTruthy();
    expect(screen.queryByText(session.dialog_code_description)).toBeNull();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '123456' } });
    await waitFor(() => expect(totpCode).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('200'));
    expect(assign).not.toHaveBeenCalled();
    expect(api.state.keys[0]).toBe(api.state.keys[1]);
  });

  it('starts the steps afresh after a dismissed dialog, so no challenge outlives it', async () => {
    // Adversary M-1: the memoised steps held the code challenge of the dismissed dialog.
    stubApi();
    vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    const factory = vi.fn((): Reauthentication => ({
      password: () => Promise.resolve({ kind: 'code' as const }),
      code: () => Promise.resolve({ kind: 'done' as const }),
    }));
    renderIn(
      locale,
      <SessionProvider me={me} surface="staff" reauthentication={factory}>
        <Page dirty />
      </SessionProvider>,
    );
    const close = messages[locale].common.actions.close;
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('dialog', { name: session.dialog_title });
    const calls = factory.mock.calls.length;
    fireEvent.change(screen.getByLabelText(messages[locale].auth.fields.password), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: session.dialog_submit }));
    await screen.findByText(session.dialog_code_description);
    fireEvent.click(screen.getByRole('button', { name: close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('dialog', { name: session.dialog_title });
    expect(screen.getByText(session.dialog_description)).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLInputElement>(messages[locale].auth.fields.password).value,
    ).toBe('');
    expect(factory.mock.calls.length).toBeGreaterThan(calls);
  });

  it('signs out through logout, clears sessionStorage and leaves for the signed-out page', async () => {
    const api = stubApi();
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    window.sessionStorage.setItem('el_challenge', 'x');
    renderIn(
      locale,
      <SessionProvider me={me} surface="staff" reauthentication={() => steps({ kind: 'done' })}>
        <UserMenu />
      </SessionProvider>,
    );
    const trigger = screen.getByRole('button', { name: `${session.user_menu}: Huda Al-Qahtani` });
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    expect(await screen.findByText('Riyadh Fresh')).toBeTruthy();
    fireEvent.click(await screen.findByRole('menuitem', { name: session.sign_out }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/signed-out'));
    const logout = api.fetch.mock.calls.find(([url]) => url.endsWith('/auth/logout'));
    expect(new Headers(logout?.[1]?.headers).get('x-el-client')).toBe('web');
    expect(window.sessionStorage.getItem('el_challenge')).toBeNull();
  });
  it('runs the session-end cleanups before leaving, on every ending but the kept dialog', async () => {
    // WEB-4 adversary fix round 1 (M): the console's support reasons outlived an ended session.
    stubApi();
    const order: string[] = [];
    vi.spyOn(sessionNavigation, 'assign').mockImplementation((path) => order.push(path));
    const cleanup = vi.fn(() => order.push('cleanup'));
    function Ending({ dirty }: { dirty: boolean }) {
      useSessionEndCleanup(cleanup);
      return <Page dirty={dirty} />;
    }
    window.history.replaceState(null, '', '/accounts');
    const view = renderIn(
      locale,
      <SessionProvider me={me} surface="platform" reauthentication={() => steps({ kind: 'done' })}>
        <Ending dirty={false} />
      </SessionProvider>,
    );
    // A refused refresh (idle expiry): the cleanups, then sign-in.
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(order).toEqual(['cleanup', '/sign-in?next=%2Faccounts&reason=ended']),
    );
    view.unmount();

    // With unsaved state the dialog keeps the page for the same user: nothing is forgotten yet;
    // "another account" ends the session and runs them.
    order.length = 0;
    renderIn(
      locale,
      <SessionProvider me={me} surface="platform" reauthentication={() => steps({ kind: 'done' })}>
        <Ending dirty />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByRole('dialog', { name: session.dialog_title });
    expect(order).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: session.dialog_other_user }));
    await waitFor(() =>
      expect(order).toEqual(['cleanup', '/sign-in?next=%2Faccounts&reason=ended']),
    );
  });

  it('runs the session-end cleanups on sign-out too', async () => {
    stubApi();
    const assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
    const cleanup = vi.fn();
    function Cleaning() {
      useSessionEndCleanup(cleanup);
      return <UserMenu />;
    }
    renderIn(
      locale,
      <SessionProvider me={me} surface="staff" reauthentication={() => steps({ kind: 'done' })}>
        <Cleaning />
      </SessionProvider>,
    );
    const trigger = screen.getByRole('button', { name: `${session.user_menu}: Huda Al-Qahtani` });
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: session.sign_out }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/signed-out'));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
