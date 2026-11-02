import { ApiError } from '@eeasy-logistics/contracts/http';
import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Form, SubmitButton, useContractForm } from '../src/form/form';
import { SessionProvider } from '../src/session/session-provider';
import {
  OpeningHoursEditor,
  PointFields,
  ShortCodeField,
  siteFormSchema,
  siteFormValues,
  type SiteBody,
} from '../src/settings/site-form';
import { SiteKindChip, SiteStatusChip } from '../src/settings/status-chips';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-3 leg 2, item E: the site form's schema (the API's rules and the transform to the whole
// body), the short code, the point with its map link, the opening hours editor, `Form`'s page text
// for a refusal, and the site chips, in both reading directions.

afterEach(() => {
  vi.restoreAllMocks();
});

const me = { user: { name: 'Huda', email: 'huda@example.test' }, permissions: [] };
const steps = () => ({
  password: () => Promise.resolve({ kind: 'done' as const }),
  code: () => Promise.resolve({ kind: 'done' as const }),
});

const branch: SiteBody = {
  kind: 'branch',
  name_ar: 'فرع العليا',
  name_en: 'Olaya branch',
  address_text: 'طريق العليا',
  national_address_short_code: 'RRRD2929',
  point: { lat: 24.69384, lng: 46.68512 },
  opening_hours: [
    { weekday: 0, opens: '09:00', closes: '21:00' },
    { weekday: 4, opens: '22:00', closes: '02:00' },
  ],
};

function SiteFormUnderTest({
  site,
  onSubmit,
  describeError,
}: {
  site?: SiteBody;
  onSubmit: (body: SiteBody) => Promise<void>;
  describeError?: (error: unknown) => string | undefined;
}) {
  const form = useContractForm(siteFormSchema, siteFormValues(site));
  return (
    <SessionProvider me={me} surface="staff" reauthentication={steps}>
      <Form form={form} onSubmit={(body) => onSubmit(body)} describeError={describeError}>
        <ShortCodeField />
        <PointFields />
        <OpeningHoursEditor />
        <SubmitButton requireChange={false}>Save</SubmitButton>
      </Form>
    </SessionProvider>
  );
}

describe('the site form schema', () => {
  it('turns the form values back into the same body', () => {
    expect(siteFormSchema.parse(siteFormValues(branch))).toEqual(branch);
  });

  it('leaves empty optional fields out, which the API reads as cleared', () => {
    const values = {
      ...siteFormValues({ kind: 'warehouse', name_ar: 'مستودع', name_en: 'Store' }),
      address_text: '  ',
    };
    expect(siteFormSchema.parse(values)).toEqual({
      kind: 'warehouse',
      name_ar: 'مستودع',
      name_en: 'Store',
      opening_hours: [],
    });
  });

  it('upper-cases the short code and refuses another shape', () => {
    const values = siteFormValues(branch);
    expect(
      siteFormSchema.parse({ ...values, national_address_short_code: 'rrrd2929' })
        .national_address_short_code,
    ).toBe('RRRD2929');
    const bad = siteFormSchema.safeParse({ ...values, national_address_short_code: 'RRR2929' });
    expect(bad.error?.issues[0]).toMatchObject({
      path: ['national_address_short_code'],
      message: 'invalid',
    });
  });

  it('counts names in code points, one line, 1 to 120', () => {
    const values = siteFormValues(branch);
    const long = siteFormSchema.safeParse({ ...values, name_ar: 'ب'.repeat(121) });
    expect(long.error?.issues[0]).toMatchObject({ path: ['name_ar'], message: 'too_long' });
    expect(siteFormSchema.safeParse({ ...values, name_en: '😀'.repeat(120) }).success).toBe(true);
    expect(siteFormSchema.safeParse({ ...values, name_en: 'a\nb' }).success).toBe(false);
    expect(siteFormSchema.safeParse({ ...values, name_en: '' }).success).toBe(false);
  });

  it('wants both coordinates or neither, within range', () => {
    const values = siteFormValues(branch);
    const half = siteFormSchema.safeParse({ ...values, lng: Number.NaN });
    expect(half.error?.issues[0]).toMatchObject({ path: ['lng'], message: 'required' });
    const far = siteFormSchema.safeParse({ ...values, lat: 91 });
    expect(far.error?.issues[0]).toMatchObject({ path: ['lat'], message: 'invalid' });
  });

  it('checks the times of open days only', () => {
    const values = siteFormValues(branch);
    const hours = values.hours.map((row) =>
      row.weekday === 0
        ? { ...row, closes: '25:00' }
        : row.weekday === 1
          ? { ...row, opens: 'x' }
          : row,
    );
    const parsed = siteFormSchema.safeParse({ ...values, hours });
    expect(parsed.error?.issues).toHaveLength(1);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['hours', 0, 'closes'],
      message: 'invalid',
    });
  });
});

describe.each(directions)('site form in $locale ($dir)', ({ locale }) => {
  const sites = messages[locale].settings.sites;

  it('upper-cases the short code when the field is left, left to right', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <SiteFormUnderTest onSubmit={submit} />);
    const code = screen.getByLabelText(sites.form.short_code);
    expect(code.getAttribute('dir')).toBe('ltr');
    fireEvent.change(code, { target: { value: 'rrrd2929' } });
    fireEvent.blur(code);
    await waitFor(() => expect((code as HTMLInputElement).value).toBe('RRRD2929'));
  });

  it('offers "open in maps" once both coordinates are numbers, in Western digits', () => {
    renderIn(locale, <SiteFormUnderTest site={branch} onSubmit={() => Promise.resolve()} />);
    const link = screen.getByRole('link', { name: new RegExp(sites.form.open_in_maps) });
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps?q=24.69384,46.68512');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).not.toMatch(arabicIndicDigits);
    expect(screen.getByLabelText(sites.form.lat).getAttribute('inputmode')).toBe('decimal');
    fireEvent.change(screen.getByLabelText(sites.form.lng), { target: { value: '' } });
    expect(screen.queryByRole('link', { name: new RegExp(sites.form.open_in_maps) })).toBeNull();
  });

  it('shows the hours per weekday with the closed days closed, and "same every day"', async () => {
    const submit = vi.fn<(body: SiteBody) => Promise<void>>(() => Promise.resolve());
    renderIn(locale, <SiteFormUnderTest site={branch} onSubmit={submit} />);
    const sunday = screen.getByRole('group', { name: sites.weekdays['0'] });
    expect(within(sunday).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(
      within(sunday)
        .getAllByRole('textbox')
        .map((box) => (box as HTMLInputElement).value),
    ).toEqual(['09:00', '21:00']);
    const monday = screen.getByRole('group', { name: sites.weekdays['1'] });
    expect(within(monday).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(within(monday).getByText(sites.form.closed)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: sites.form.same_every_day }));
    expect(within(monday).getAllByRole('textbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const body = submit.mock.calls[0]![0];
    expect(body.opening_hours).toHaveLength(7);
    expect(
      body.opening_hours?.every((row) => row.opens === '09:00' && row.closes === '21:00'),
    ).toBe(true);
  });

  it('shows a bad time under its row and sends nothing', async () => {
    const submit = vi.fn(() => Promise.resolve());
    renderIn(locale, <SiteFormUnderTest site={branch} onSubmit={submit} />);
    const sunday = screen.getByRole('group', { name: sites.weekdays['0'] });
    fireEvent.change(within(sunday).getAllByRole('textbox')[1]!, { target: { value: '9pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await within(sunday).findByText(messages[locale].errors.fields.invalid)).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it("Form shows a page's own text for a refusal it describes", async () => {
    const limit = new ApiError({
      status: 422,
      code: 'limit_exceeded',
      message: '',
      headers: new Headers(),
    });
    renderIn(
      locale,
      <SiteFormUnderTest
        site={branch}
        onSubmit={() => Promise.reject(limit)}
        describeError={(error) =>
          error instanceof ApiError && error.code === 'limit_exceeded' ? 'Limit 5' : undefined
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Limit 5');
  });

  it('site chips name the state and the kind', () => {
    renderIn(
      locale,
      <>
        <SiteStatusChip status="inactive" />
        <SiteKindChip kind="both" />
      </>,
    );
    expect(screen.getByText(sites.status.inactive)).toBeTruthy();
    expect(screen.getByText(sites.kinds.both)).toBeTruthy();
  });
});
