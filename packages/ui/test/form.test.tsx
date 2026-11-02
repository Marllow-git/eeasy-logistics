import { ApiError } from '@eeasy-logistics/contracts/http';
import { schemas } from '@eeasy-logistics/contracts/staff';
import { messages } from '@eeasy-logistics/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BilingualField,
  CheckboxGroupField,
  NumberField,
  RadioGroupField,
  SwitchField,
} from '../src/form/fields';
import {
  Form,
  SubmitButton,
  changedValues,
  fieldCodeOf,
  pointerToPath,
  useContractForm,
  type SubmitContext,
} from '../src/form/form';
import { SessionProvider } from '../src/session/session-provider';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-3 plan 2.3: `Form` over a generated body schema (react-hook-form, the catalogue's field
// messages, `validation_failed` pointers, the intent's Idempotency-Key, changed fields only) and
// its field components, in both reading directions.

afterEach(() => {
  vi.restoreAllMocks();
});

const me = { user: { name: 'Huda', email: 'huda@example.test' }, permissions: [] };
const steps = () => ({
  password: () => Promise.resolve({ kind: 'done' as const }),
  code: () => Promise.resolve({ kind: 'done' as const }),
});

// One section of the account settings PATCH (2.6): the generated schema, picked.
const section = schemas.UpdateAccountSettingsBody.pick({
  intake_rule: true,
  max_attempts: true,
  second_factor_required: true,
  allowed_cod_methods: true,
});
type Section = typeof section;

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function SettingsSection({
  onSubmit,
}: {
  onSubmit: (values: unknown, context: SubmitContext<Record<string, unknown>>) => Promise<unknown>;
}) {
  const form = useContractForm(section, {
    intake_rule: 'receive_as_pending',
    max_attempts: 3,
    second_factor_required: false,
    allowed_cod_methods: ['cash'],
  });
  return (
    <Form
      form={form}
      onSubmit={async (values, context) => {
        await onSubmit(values, context);
        form.reset(values);
      }}
    >
      <RadioGroupField<Section['_input'], 'intake_rule'>
        name="intake_rule"
        label="Intake"
        options={[
          { value: 'receive_as_pending', label: 'Pending' },
          { value: 'auto_accept', label: 'Accept', description: 'Orders skip review' },
        ]}
      />
      <NumberField<Section['_input'], 'max_attempts'>
        name="max_attempts"
        label="Attempts"
        description="1 to 10"
        min={1}
        max={10}
      />
      <SwitchField<Section['_input'], 'second_factor_required'>
        name="second_factor_required"
        label="Second factor"
      />
      <CheckboxGroupField<Section['_input'], 'allowed_cod_methods'>
        name="allowed_cod_methods"
        label="COD"
        options={[
          { value: 'cash', label: 'Cash' },
          { value: 'card', label: 'Card', disabled: true, description: 'Not yet' },
        ]}
      />
      <SubmitButton />
    </Form>
  );
}

function inSession(ui: React.ReactNode) {
  return (
    <SessionProvider me={me} surface="staff" reauthentication={steps}>
      {ui}
    </SessionProvider>
  );
}

const refusal = (code: string, details?: Record<string, unknown>, headers = new Headers()) =>
  new ApiError({
    status: code === 'rate_limited' ? 429 : 400,
    code: code as never,
    message: '',
    details,
    headers,
  });

describe('form helpers', () => {
  it('maps a body pointer onto a field path and refuses anything else', () => {
    expect(pointerToPath('/body/max_attempts')).toBe('max_attempts');
    expect(pointerToPath('/body/reason_codes/0/code')).toBe('reason_codes.0.code');
    expect(pointerToPath('/body/a~1b/c~0d')).toBe('a/b.c~d');
    expect(pointerToPath('/query/status')).toBeUndefined();
    expect(pointerToPath('/body/')).toBeUndefined();
  });

  it('keeps only the top-level fields with a change, whole', () => {
    const values = {
      max_attempts: 4,
      intake_rule: 'auto_accept',
      proof_policy: { delivery: ['photo'], cod: ['signature'] },
      reason_codes: [{ code: 'a' }, { code: 'b' }],
    };
    expect(
      changedValues(values, {
        max_attempts: true,
        intake_rule: false,
        proof_policy: { cod: [true] },
        reason_codes: [undefined, { code: true }],
      }),
    ).toEqual({
      max_attempts: 4,
      proof_policy: values.proof_policy,
      reason_codes: values.reason_codes,
    });
    expect(changedValues(values, {})).toEqual({});
  });

  it('turns Zod issues into catalogue field codes', () => {
    expect(fieldCodeOf({ code: 'invalid_type', input: undefined })).toBe('required');
    expect(fieldCodeOf({ code: 'too_small', input: '', origin: 'string' })).toBe('required');
    expect(fieldCodeOf({ code: 'too_small', input: 'a', origin: 'string' })).toBe('too_short');
    expect(fieldCodeOf({ code: 'too_big', input: 'abc', origin: 'string' })).toBe('too_long');
    expect(fieldCodeOf({ code: 'too_big', input: 11, origin: 'number' })).toBe('invalid');
    expect(fieldCodeOf({ code: 'invalid_value', input: 'x' })).toBe('invalid');
  });
});

describe.each(directions)('Form in $locale ($dir)', ({ locale, dir }) => {
  const fields = messages[locale].errors.fields;
  const form = messages[locale].common.form;
  const save = () => screen.getByRole('button', { name: form.save });

  it('keeps Save disabled until a field changes, then sends the changed fields with a v7 key', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    expect(save().hasAttribute('disabled')).toBe(true);
    const attempts = screen.getByLabelText('Attempts');
    expect(attempts.getAttribute('dir')).toBe('ltr');
    fireEvent.change(attempts, { target: { value: '5' } });
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const [values, context] = submit.mock.calls[0] as unknown as [
      unknown,
      SubmitContext<Record<string, unknown>>,
    ];
    expect(values).toMatchObject({ max_attempts: 5, intake_rule: 'receive_as_pending' });
    expect(context.changed).toEqual({ max_attempts: 5 });
    expect(context.idempotencyKey).toMatch(uuidV7);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(form.saved));
    expect(document.documentElement.dir).toBe(dir);
  });

  it('shows the catalogue message of a client-side failure on the field, with aria wiring', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    const attempts = screen.getByLabelText('Attempts');
    fireEvent.change(attempts, { target: { value: '11' } });
    fireEvent.click(save());
    await waitFor(() => expect(attempts.getAttribute('aria-invalid')).toBe('true'));
    const described = (attempts.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['1 to 10', fields.invalid]);
    fireEvent.change(attempts, { target: { value: '' } });
    fireEvent.blur(attempts);
    await waitFor(() => expect(screen.getByText(fields.required)).toBeTruthy());
    expect(submit).not.toHaveBeenCalled();
  });

  it('maps validation_failed pointers onto fields and keeps the key for the retry', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        refusal('validation_failed', {
          fields: [{ pointer: '/body/allowed_cod_methods', code: 'owner_gate' }],
        }),
      )
      .mockResolvedValueOnce(undefined);
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '6' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(fields.owner_gate)).toBeTruthy());
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const keys = submit.mock.calls.map(
      (call) => (call[1] as SubmitContext<unknown>).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('a new intent after a success gets a new key', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '4' } });
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '7' } });
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const keys = submit.mock.calls.map(
      (call) => (call as unknown as [unknown, SubmitContext<unknown>])[1].idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('shows an unmapped pointer at the form level', async () => {
    const submit = vi.fn(() =>
      Promise.reject(
        refusal('validation_failed', { fields: [{ pointer: '/query/x', code: 'invalid' }] }),
      ),
    );
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '4' } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        messages[locale].errors.codes.validation_failed,
      ),
    );
  });

  it('holds the submit while rate_limited waits, with the wait in Western digits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const submit = vi.fn(() =>
      Promise.reject(refusal('rate_limited', undefined, new Headers({ 'Retry-After': '30' }))),
    );
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '4' } });
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('30');
    expect(alert.textContent).not.toMatch(arabicIndicDigits);
    expect(save().hasAttribute('disabled')).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(save().hasAttribute('disabled')).toBe(false);
    vi.useRealTimers();
  });

  it('radio, switch and checkbox group change their values; a disabled option explains why', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, inSession(<SettingsSection onSubmit={submit} />));
    fireEvent.click(screen.getByRole('radio', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Second factor' }));
    const card = screen.getByRole('checkbox', { name: 'Card' });
    expect(card.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Not yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cash' }));
    fireEvent.click(save());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const context = (submit.mock.calls[0] as unknown as [unknown, SubmitContext<unknown>])[1];
    expect(context.changed).toEqual({
      intake_rule: 'auto_accept',
      second_factor_required: true,
      allowed_cod_methods: [],
    });
  });
});

const pair = schemas.UpdateAccountSettingsBody.shape.reason_codes.unwrap().element;

function LabelPair() {
  const form = useContractForm(pair.pick({ label_ar: true, label_en: true }), {
    label_ar: '',
    label_en: '',
  });
  return (
    <Form form={form} onSubmit={() => Promise.resolve()}>
      <BilingualField names={{ ar: 'label_ar', en: 'label_en' }} legend="Label" />
      <SubmitButton requireChange={false} />
    </Form>
  );
}

describe.each(directions)('BilingualField in $locale ($dir)', ({ locale }) => {
  const names = messages[locale].common.locale;

  it('puts Arabic first, each input with its own lang and dir', () => {
    renderIn(locale, inSession(<LabelPair />));
    const group = screen.getByRole('group', { name: 'Label' });
    const inputs = within(group).getAllByRole('textbox');
    expect(inputs.map((input) => [input.getAttribute('lang'), input.getAttribute('dir')])).toEqual([
      ['ar', 'rtl'],
      ['en', 'ltr'],
    ]);
    expect(within(group).getByLabelText(names.ar)).toBe(inputs[0]);
  });
});
