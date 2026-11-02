import { scrubEvent } from '../src/observability/scrub';

// Sentry's beforeSend (driver app §11, DRV-1 plan 2.10): ids stay, personal data and bodies go.
describe('scrubEvent', () => {
  it('strips phones, codes, tokens, bodies and user fields but keeps ids', () => {
    const event = scrubEvent({
      message: 'verify failed for +966 50 000 0001 with code 123456',
      user: { id: 'driver-1', username: 'Ahmed', phone_number: '+966500000001' },
      request: {
        url: 'https://api.test/v1/driver/me',
        data: { pin: '1234' },
        headers: { Authorization: 'Bearer eyJabc.def.ghi' },
      },
      exception: { values: [{ value: 'Bearer abc.def token refused' }] },
      breadcrumbs: [{ message: 'otp 654321', data: { body: '{"code":"654321"}' } }],
      extra: { phone: '+966500000001' },
    });

    expect(event.message).toBe('verify failed for [number] with code [number]');
    expect(event.user).toEqual({ id: 'driver-1' });
    expect(event.request).toEqual({ url: 'https://api.test/v1/driver/me' });
    expect(event.exception?.values?.[0]?.value).toBe('Bearer [redacted] token refused');
    expect(event.breadcrumbs).toEqual([{ message: 'otp [number]', data: undefined }]);
    expect(event.extra).toBeUndefined();
  });
});
