import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Form, SubmitButton, useContractForm, type SubmitContext } from '../src/form/form';
import { SessionProvider } from '../src/session/session-provider';
import {
  ReasonCodesEditor,
  maxReasonCodes,
  reasonCodesSection,
  type ReasonCodesValues,
} from '../src/settings/reason-codes';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-3 plan 2.6, 2.11: the reason-code editor of the account settings (add, remove, the code
// rule, labels in both languages, at most 100, one PATCH of the whole list), in both directions.

const steps = () => ({
  password: () => Promise.resolve({ kind: 'done' as const }),
  code: () => Promise.resolve({ kind: 'done' as const }),
});

function Editor({
  initial,
  onSubmit,
  disabled = false,
}: {
  initial: ReasonCodesValues['reason_codes'];
  onSubmit: (values: unknown, context: SubmitContext<unknown>) => Promise<unknown>;
  disabled?: boolean;
}) {
  const form = useContractForm(reasonCodesSection, { reason_codes: initial }, { disabled });
  return (
    <SessionProvider me={{ permissions: [] }} surface="staff" reauthentication={steps}>
      <Form form={form} onSubmit={(values, context) => onSubmit(values, context)}>
        <ReasonCodesEditor disabled={disabled} />
        {disabled ? null : <SubmitButton />}
      </Form>
    </SessionProvider>
  );
}

const existing = [
  { code: 'not_home', label_ar: 'المستلم غير موجود', label_en: 'Not home', active: true },
];

describe.each(directions)('ReasonCodesEditor in $locale ($dir)', ({ locale }) => {
  const t = messages[locale].settings.account.reason_codes;
  const fields = messages[locale].errors.fields;
  const names = messages[locale].common.locale;
  const save = () => screen.getByRole('button', { name: messages[locale].common.form.save });

  it('adds a row, refuses a bad code on its field, and sends the whole list', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <Editor initial={existing} onSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: t.add }));
    const rows = screen
      .getAllByRole('group', { name: /./ })
      .filter((group) => group.getAttribute('aria-labelledby')?.length);
    expect(rows).toHaveLength(2);
    const added = rows[1]!;
    expect(within(added).getByRole('heading').textContent).not.toMatch(arabicIndicDigits);
    const code = within(added).getByLabelText(t.code);
    expect(code.getAttribute('dir')).toBe('ltr');
    fireEvent.change(code, { target: { value: 'Bad Code' } });
    fireEvent.blur(code);
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'));
    expect(within(added).getByText(fields.invalid)).toBeTruthy();
    fireEvent.change(code, { target: { value: 'wrong_address' } });
    fireEvent.change(within(added).getByLabelText(names.ar), { target: { value: 'عنوان خاطئ' } });
    fireEvent.change(within(added).getByLabelText(names.en), {
      target: { value: 'Wrong address' },
    });
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const context = (submit.mock.calls[0] as unknown as [unknown, SubmitContext<unknown>])[1];
    expect(context.changed).toEqual({
      reason_codes: [
        existing[0],
        { code: 'wrong_address', label_ar: 'عنوان خاطئ', label_en: 'Wrong address', active: true },
      ],
    });
  });

  it('needs both labels and refuses a repeated code', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <Editor initial={existing} onSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: t.add }));
    const codes = screen.getAllByLabelText(t.code);
    fireEvent.change(codes[1]!, { target: { value: 'not_home' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getAllByText(fields.required)).toHaveLength(2));
    expect(screen.getAllByText(fields.invalid)).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('removes a row by its labelled button', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <Editor initial={existing} onSubmit={submit} />);
    const remove = screen.getByRole('button', { name: t.remove.replace('{number}', '1') });
    fireEvent.click(remove);
    expect(screen.getByText(t.empty)).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(
      (submit.mock.calls[0] as unknown as [unknown, SubmitContext<unknown>])[1].changed,
    ).toEqual({ reason_codes: [] });
  });

  it(`stops adding at ${maxReasonCodes} rows`, () => {
    const many = Array.from({ length: maxReasonCodes }, (_, index) => ({
      code: `code_${index}`,
      label_ar: 'سبب',
      label_en: 'Reason',
      active: true,
    }));
    renderIn(locale, <Editor initial={many} onSubmit={() => Promise.resolve()} />);
    expect(screen.getByRole('button', { name: t.add }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(t.limit)).toBeTruthy();
  });

  it('read-only: no add or remove controls, every input disabled', () => {
    renderIn(locale, <Editor initial={existing} onSubmit={() => Promise.resolve()} disabled />);
    expect(screen.queryByRole('button')).toBeNull();
    for (const input of screen.getAllByRole('textbox'))
      expect(input.hasAttribute('disabled')).toBe(true);
  });
});
