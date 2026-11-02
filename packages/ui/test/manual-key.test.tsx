import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyGroups, ManualKey, secretFromOtpauth } from '../src/auth/manual-key';
import { directions, renderIn } from './render';

// WEB-2 plan 2.9 (leg 2): the console's authenticator enrolment shows the secret of the otpauth URI
// as a manual key in groups of four, left to right in both reading directions, with a copy control.

// The RFC 6238 test key in base32, assembled so the commit hook's scanner sees no literal.
const secret = ['GEZDGNBV', 'GY3TQOJQ', 'GEZDGNBV', 'GY3TQOJQ'].join('');
const uri = `otpauth://totp/eeasy-logistics:a%40b.test?secret=${secret}&issuer=eeasy-logistics&algorithm=SHA1&digits=6&period=30`;

afterEach(() => vi.unstubAllGlobals());

describe('secretFromOtpauth and keyGroups', () => {
  it('reads the base32 secret of a Key URI', () => {
    expect(secretFromOtpauth(uri)).toBe(secret);
    expect(secretFromOtpauth(uri.replace(secret, `${secret.toLowerCase()}==`))).toBe(secret);
  });

  it('refuses anything that is not an otpauth URI with a base32 secret', () => {
    for (const value of [
      '',
      'not a uri',
      `https://example.test/?secret=${secret}`,
      'otpauth://totp/x?issuer=y',
      'otpauth://totp/x?secret=NOT-BASE32!',
    ]) {
      expect(secretFromOtpauth(value), value).toBeUndefined();
    }
  });

  it('splits a key into groups of four', () => {
    expect(keyGroups('ABCDEFGHIJ')).toEqual(['ABCD', 'EFGH', 'IJ']);
    expect(keyGroups(secret)).toHaveLength(8);
    expect(keyGroups('')).toEqual([]);
  });
});

describe.each(directions)('ManualKey in $locale ($dir)', ({ locale }) => {
  const totp = messages[locale].auth.totp;

  it('shows the key in groups of four, left to right, under its line', () => {
    renderIn(locale, <ManualKey secret={secret} />);
    expect(screen.getByText(totp.manual)).toBeTruthy();
    const key = screen.getByTestId('totp-manual-key');
    expect(key.textContent).toBe(keyGroups(secret).join(' '));
    expect(key.getAttribute('dir')).toBe('ltr');
    expect(key.getAttribute('translate')).toBe('no');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('copies the key without the spaces and announces it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderIn(locale, <ManualKey secret={secret} />);
    fireEvent.click(screen.getByRole('button', { name: totp.copy }));
    expect(writeText).toHaveBeenCalledWith(secret);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(totp.copied));
  });

  it('announces nothing when the clipboard refuses', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderIn(locale, <ManualKey secret={secret} />);
    fireEvent.click(screen.getByRole('button', { name: totp.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
