import { ApiError } from '@eeasy-logistics/contracts/http';
import { schemas } from '@eeasy-logistics/contracts/staff';
import { messages } from '@eeasy-logistics/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/confirm-dialog/confirm-dialog';
import { CheckboxGroupField, TextAreaField } from '../src/form/fields';
import { Form, SubmitButton, fieldCodeOf, useContractForm } from '../src/form/form';
import { SessionProvider } from '../src/session/session-provider';
import { MemberStatusChip, RoleChip } from '../src/settings/status-chips';
import { ChipFilter, SearchFilter, SelectFilter } from '../src/table/filters';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-3 leg 2, item D: the confirm dialog, the list filters, the text area and the option with a
// reason (a rule shown on a disabled checkbox), and the member chips, in both reading directions.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// jsdom has no scrollIntoView; Radix Select scrolls its selected option into view on open.
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => undefined });
}

const me = { user: { name: 'Huda', email: 'huda@example.test' }, permissions: [] };
const steps = () => ({
  password: () => Promise.resolve({ kind: 'done' as const }),
  code: () => Promise.resolve({ kind: 'done' as const }),
});
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const refusal = (code: string, status = 403) =>
  new ApiError({ status, code: code as never, message: '', headers: new Headers() });

function Confirming({
  onConfirm,
  describeError,
}: {
  onConfirm: (key: string) => Promise<void>;
  describeError?: (error: unknown) => string | undefined;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p data-testid="state">{open ? 'open' : 'closed'}</p>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Revoke Huda?"
        consequences={['Signed out everywhere', 'The audit log keeps her actions']}
        confirmLabel="Revoke"
        onConfirm={onConfirm}
        describeError={describeError}
      />
    </>
  );
}

const reset = schemas.ResetMemberSecondFactorBody;
const access = schemas.UpdateMemberBody.required({ roles: true });

function ReasonForm({ onSubmit }: { onSubmit: (reason: string) => Promise<void> }) {
  const form = useContractForm(reset, { reason: '' });
  return (
    <SessionProvider me={me} surface="staff" reauthentication={steps}>
      <Form form={form} onSubmit={async (values) => onSubmit(values.reason)}>
        <TextAreaField<typeof reset._input, 'reason'>
          name="reason"
          label="Reason"
          maxLength={500}
        />
        <SubmitButton requireChange={false}>Reset</SubmitButton>
      </Form>
    </SessionProvider>
  );
}

function RolesForm({ ownerReason }: { ownerReason: string }) {
  const form = useContractForm(access, { roles: ['viewer'] });
  return (
    <SessionProvider me={me} surface="staff" reauthentication={steps}>
      <Form form={form} onSubmit={() => Promise.resolve()}>
        <CheckboxGroupField<typeof access._input, 'roles'>
          name="roles"
          label="Roles"
          options={[
            { value: 'owner', label: 'Owner', disabled: true, reason: ownerReason },
            { value: 'viewer', label: 'Viewer' },
          ]}
        />
        <SubmitButton>Save</SubmitButton>
      </Form>
    </SessionProvider>
  );
}

describe('fieldCodeOf for lists', () => {
  it('asks for a choice when a list that needs one is empty', () => {
    expect(fieldCodeOf({ code: 'too_small', origin: 'array', input: [] })).toBe('required');
    expect(fieldCodeOf({ code: 'too_small', origin: 'array', input: ['a'] })).toBe('invalid');
  });
});

describe.each(directions)('members kit in $locale ($dir)', ({ locale, dir }) => {
  const catalogue = messages[locale];

  it('ConfirmDialog is an alert dialog with the consequences, Cancel and a busy confirm', async () => {
    let finish: () => void = () => undefined;
    const confirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderIn(locale, <Confirming onConfirm={confirm} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke Huda?' });
    expect(document.documentElement.dir).toBe(dir);
    expect(dialog.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('button', { name: catalogue.common.actions.cancel })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const busy = await screen.findByRole('button', { name: catalogue.common.form.saving });
    expect(busy).toHaveProperty('disabled', true);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(uuidV7));
    await act(() => {
      finish();
      return Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
  });

  it('ConfirmDialog keeps the key across a retry and shows the refusal inside', async () => {
    const confirm = vi
      .fn<(key: string) => Promise<void>>()
      .mockRejectedValueOnce(refusal('forbidden'))
      .mockResolvedValueOnce(undefined);
    renderIn(locale, <Confirming onConfirm={confirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect((await screen.findByRole('alert')).textContent).toBe(catalogue.errors.codes.forbidden);
    expect(screen.getByTestId('state').textContent).toBe('open');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(confirm.mock.calls[0]?.[0]).toBe(confirm.mock.calls[1]?.[0]);
  });

  it("ConfirmDialog shows a page's own text for a refusal it describes", async () => {
    renderIn(
      locale,
      <Confirming
        onConfirm={() => Promise.reject(refusal('site_in_use', 409))}
        describeError={(error) =>
          error instanceof ApiError && error.code === 'site_in_use' ? 'Open orders' : undefined
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Open orders');
  });

  it('ChipFilter presses one chip, "All" for none', () => {
    const change = vi.fn();
    renderIn(
      locale,
      <ChipFilter
        label="Status"
        allLabel="All"
        options={[
          { value: 'active', label: 'Active' },
          { value: 'revoked', label: 'Revoked' },
        ]}
        value="active"
        onChange={change}
      />,
    );
    const group = screen.getByRole('group', { name: 'Status' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Active' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(change).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Revoked' }));
    expect(change).toHaveBeenLastCalledWith('revoked');
  });

  it('SelectFilter shows "All" for no value and reports a choice', async () => {
    const change = vi.fn();
    renderIn(
      locale,
      <SelectFilter
        label="Site"
        allLabel="All sites"
        options={[{ value: 'site-1', label: 'Riyadh' }]}
        value={undefined}
        onChange={change}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Site' });
    expect(trigger.textContent).toContain('All sites');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Riyadh' }));
    expect(change).toHaveBeenCalledWith('site-1');
  });

  it('SearchFilter reports the trimmed text after the pause, at once on Enter', () => {
    vi.useFakeTimers();
    const change = vi.fn();
    renderIn(
      locale,
      <SearchFilter label="Search" value={undefined} onChange={change} delay={300} />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(input, { target: { value: '  huda ' } });
    expect(change).not.toHaveBeenCalled();
    void act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(change).toHaveBeenCalledWith('huda');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).toHaveBeenLastCalledWith(undefined);
  });

  it('SearchFilter keeps an invalid value in the input with its message', () => {
    vi.useFakeTimers();
    const change = vi.fn();
    renderIn(
      locale,
      <SearchFilter
        label="Actor"
        value={undefined}
        onChange={change}
        valid={(value) => /^\d+$/.test(value)}
        invalidMessage="Digits only"
        dir="ltr"
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Actor' });
    fireEvent.change(input, { target: { value: 'abc' } });
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Digits only')).toBeTruthy();
  });

  it('TextAreaField takes its direction from the text and shows the length rule', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <ReasonForm onSubmit={submit} />);
    const area = screen.getByRole('textbox', { name: 'Reason' });
    expect(area.getAttribute('dir')).toBe('auto');
    expect(area.getAttribute('maxlength')).toBe('500');
    fireEvent.change(area, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(await screen.findByText(catalogue.errors.fields.too_short)).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: 'lost the phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('lost the phone'));
  });

  it('a disabled option with a reason carries it as its description and tooltip', () => {
    renderIn(locale, <RolesForm ownerReason="Only an owner grants this" />);
    const owner = screen.getByRole('checkbox', { name: 'Owner' });
    expect(owner).toHaveProperty('disabled', true);
    const described = owner.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe('Only an owner grants this');
    expect(owner.closest('[data-disabled-reason]')).not.toBeNull();
    const viewer = screen.getByRole('checkbox', { name: 'Viewer' });
    expect(viewer).toHaveProperty('disabled', false);
    expect(viewer.closest('[data-disabled-reason]')).toBeNull();
  });

  it('an empty role list asks for a choice', async () => {
    renderIn(locale, <RolesForm ownerReason="x" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(catalogue.errors.fields.required)).toBeTruthy();
  });

  it('member chips name the state and the role in the reading language', () => {
    renderIn(
      locale,
      <>
        <MemberStatusChip status="invited" />
        <MemberStatusChip status="active" />
        <RoleChip role="warehouse_staff" />
        <RoleChip role="unknown_role" />
      </>,
    );
    const settings = catalogue.settings;
    expect(screen.getByText(settings.members.status.invited)).toBeTruthy();
    expect(screen.getByText(settings.members.status.active)).toBeTruthy();
    expect(screen.getByText(settings.roles.warehouse_staff)).toBeTruthy();
    expect(screen.getByText('unknown_role')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(arabicIndicDigits);
  });
});
