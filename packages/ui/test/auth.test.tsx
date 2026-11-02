import { ApiError } from '@eeasy-logistics/contracts/http';
import { messages } from '@eeasy-logistics/i18n';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthCard } from '../src/auth/auth-card';
import { retryAfterSeconds, useErrorMessage } from '../src/auth/error-message';
import { PhoneField, saudiMobileE164 } from '../src/auth/phone-field';
import { QrCode, qrPath } from '../src/auth/qr-code';
import { ResendButton } from '../src/auth/resend-button';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-2 plan 2.10: the remaining sign-in components in both reading directions, and the error
// messages the forms show.

afterEach(() => vi.useRealTimers());

const apiError = (code: string, headers: Record<string, string> = {}) =>
  new ApiError({
    status: code === 'rate_limited' ? 429 : 401,
    code: code as ApiError['code'],
    message: 'server text that must not be shown',
    headers: new Headers(headers),
  });

function ErrorText({ error }: { error: unknown }) {
  return <p>{useErrorMessage()(error)}</p>;
}

describe('saudiMobileE164 and retryAfterSeconds', () => {
  it('accepts the ways people type a Saudi mobile number', () => {
    for (const typed of [
      '501234567',
      '0501234567',
      '+966 50 123 4567',
      '966501234567',
      '50-123-4567',
    ]) {
      expect(saudiMobileE164(typed), typed).toBe('+966501234567');
    }
  });

  it('refuses anything else', () => {
    for (const typed of ['', '12345', '401234567', '5012345678', '+971501234567', 'phone']) {
      expect(saudiMobileE164(typed), typed).toBeUndefined();
    }
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterSeconds(apiError('rate_limited', { 'Retry-After': '42' }))).toBe(42);
    expect(
      retryAfterSeconds(
        apiError('rate_limited', { 'Retry-After': new Date(90_000).toUTCString() }),
        30_000,
      ),
    ).toBe(60);
    expect(retryAfterSeconds(apiError('rate_limited'))).toBeUndefined();
    expect(retryAfterSeconds(new Error('x'))).toBeUndefined();
  });

  it('draws a QR code as one path of dark modules inside a quiet zone', () => {
    const drawn = qrPath('otpauth://totp/Eeasy:a%40b.test?secret=JBSWY3DPEHPK3PXP&issuer=Eeasy');
    expect(drawn?.size).toBeGreaterThan(21 + 8 - 1);
    expect(drawn?.path).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(drawn?.path.startsWith('M4 4')).toBe(true);
  });
});

describe.each(directions)('sign-in components in $locale ($dir)', ({ locale }) => {
  const auth = messages[locale].auth;
  const errors = messages[locale].errors;

  it('AuthCard has one heading, its line, the form and the foot', () => {
    renderIn(
      locale,
      <AuthCard
        title={auth.sign_in.title}
        description={auth.sign_in.description}
        footer={<a href="/x">foot</a>}
      >
        <form aria-label="form" />
      </AuthCard>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(auth.sign_in.title);
    expect(screen.getByText(auth.sign_in.description)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'foot' })).toBeTruthy();
  });

  it('PhoneField shows the fixed prefix, left to right, as a tel input', () => {
    renderIn(
      locale,
      <PhoneField
        label={auth.enrol.phone}
        hint={auth.enrol.phone_hint}
        error={auth.enrol.phone_invalid}
      />,
    );
    const input = screen.getByLabelText(auth.enrol.phone);
    expect(input.getAttribute('type')).toBe('tel');
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('autocomplete')).toBe('tel-national');
    expect(input.parentElement?.getAttribute('dir')).toBe('ltr');
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '+966',
      auth.enrol.phone_hint,
      auth.enrol.phone_invalid,
    ]);
    expect(screen.getByRole('alert').textContent).toBe(auth.enrol.phone_invalid);
  });

  it('ResendButton counts down in Western digits, then sends again', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const onResend = vi.fn();
    renderIn(locale, <ResendButton availableAt={1_000_000 + 5_000} onResend={onResend} />);
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toContain('5');
    expect(button.textContent).not.toMatch(arabicIndicDigits);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(button.textContent).toContain('4');
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(button.textContent).toBe(auth.resend.now);
    fireEvent.click(button);
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('ResendButton is ready at once without a cooldown', () => {
    renderIn(locale, <ResendButton availableAt={undefined} onResend={() => {}} />);
    expect(screen.getByRole('button', { name: auth.resend.now }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('QrCode is a labelled image', () => {
    renderIn(
      locale,
      <QrCode value="otpauth://totp/x?secret=JBSWY3DPEHPK3PXP" label={auth.totp.qr_label} />,
    );
    const image = screen.getByRole('img', { name: auth.totp.qr_label });
    expect(image.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
  });

  it('shows the catalogue text per error code, never the API message', () => {
    renderIn(locale, <ErrorText error={apiError('invalid_credentials')} />);
    expect(screen.getByText(errors.codes.invalid_credentials)).toBeTruthy();
    expect(screen.queryByText(/server text/)).toBeNull();
  });

  it('turns Retry-After into a wait in seconds or minutes, and a network failure into its line', () => {
    renderIn(locale, <ErrorText error={apiError('rate_limited', { 'Retry-After': '45' })} />);
    const text = screen.getByRole('paragraph').textContent ?? '';
    expect(text).toContain('45');
    expect(text).not.toMatch(arabicIndicDigits);
  });

  it('falls back to the generic message for an unknown code and names a network failure', () => {
    renderIn(
      locale,
      <>
        <ErrorText error={apiError('no_such_code')} />
        <ErrorText error={new TypeError('Failed to fetch')} />
        <ErrorText error={apiError('rate_limited', { 'Retry-After': '600' })} />
      </>,
    );
    expect(screen.getByText(errors.codes.internal_error)).toBeTruthy();
    expect(screen.getByText(auth.errors.network)).toBeTruthy();
    const paragraphs = screen.getAllByRole('paragraph').map((p) => p.textContent ?? '');
    expect(paragraphs[2]).toContain('10');
  });
});
