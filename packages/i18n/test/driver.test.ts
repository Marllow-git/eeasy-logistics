import { describe, expect, it } from 'vitest';
import { driverMessage, driverMessages } from '../src/driver';

// The driver entry (DRV-1 plan 2.2): the namespace loads in both locales and arguments interpolate.
describe('driver messages', () => {
  it('has both locales', () => {
    expect(driverMessage('ar', 'sign_in.title')).toBe('تسجيل الدخول');
    expect(driverMessage('en', 'sign_in.title')).toBe('Sign in');
    expect(Object.keys(driverMessages)).toEqual(['ar', 'en']);
  });

  it('replaces named arguments and leaves unknown ones', () => {
    expect(driverMessage('en', 'verify.resend_in', { seconds: 42 })).toBe(
      'You can request a new code in 42 seconds.',
    );
    expect(driverMessage('en', 'verify.resend_in')).toContain('{seconds}');
  });
});
