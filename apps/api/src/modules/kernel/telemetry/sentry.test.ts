import { defineConfig } from '@eeasy-logistics/config';
import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { initSentry, scrubEvent } from './sentry.js';

// PLAT-14 item E (plan 2.5): what a Sentry event may carry when it leaves the process.

const phone = '+966512345678';

const planted: ErrorEvent = {
  type: undefined,
  message: `failed for ${phone}`,
  request: {
    method: 'POST',
    url: 'https://api.example.test/v1/staff/orders/0192f0e0-1234-7000-8000-00000000abcd',
    query_string: `phone=${encodeURIComponent(phone)}`,
    cookies: { el_staff_at: 'eyJhbGciOiJIUzI1NiJ9.e30.c2ln' },
    headers: { Authorization: 'Bearer abc', 'X-Recipient-Token': 'r-1', Cookie: 'el_staff_at=x' },
    data: { recipient_phone: phone },
  },
  user: { id: 'u-1', email: 'a@b.example', ip_address: '203.0.113.7' },
  breadcrumbs: [{ message: `GET /v1/recipient/${phone}` }],
  transaction: 'GET /v1/staff/orders/0192f0e0',
  contexts: {
    runtime: { name: 'node', version: 'v24.22.2' },
    response: { status_code: 500, headers: { 'set-cookie': 'x' } },
  },
  extra: { body: { phone }, note: `call ${phone}` },
  tags: { request_id: '0192f0e0-0000-7000-8000-000000000001', hint: `to ${phone}` },
  exception: {
    values: [
      {
        type: 'Error',
        value: `no route to ${phone} with Bearer abc`,
        stacktrace: {
          frames: [{ filename: 'outbox-workers.js', lineno: 10, vars: { phone, token: 'abc' } }],
        },
      },
    ],
  },
};

describe('scrubEvent (beforeSend)', () => {
  const event = scrubEvent(planted);
  const text = JSON.stringify(event);

  it('removes cookies, Authorization and every header, the body, the URL and the query', () => {
    expect(event.request).toEqual({ method: 'POST' });
    expect(text).not.toMatch(/cookie|authorization|recipient-token|query_string/i);
    expect(text).not.toContain('0192f0e0-1234-7000-8000-00000000abcd');
  });

  it('removes the user, breadcrumbs, transaction, local variables and unknown contexts', () => {
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.transaction).toBeUndefined();
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: 'outbox-workers.js',
      lineno: 10,
    });
    expect(Object.keys(event.contexts ?? {})).toEqual(['runtime']);
  });

  it('runs the message, exception value, extra and tags through the redactor', () => {
    expect(text).not.toContain('966512345678');
    expect(text).not.toContain('Bearer abc');
    expect(event.exception?.values?.[0]?.value).toBe(
      'no route to [phone …78] with Bearer [redacted]',
    );
    expect(event.tags?.request_id).toBe('0192f0e0-0000-7000-8000-000000000001');
    expect(event.extra).toEqual({ body: '[redacted]', note: 'call [phone …78]' });
  });
});

describe('initSentry', () => {
  it('stays off without SENTRY_DSN', () => {
    expect(initSentry(defineConfig({ APP_ENV: 'ci' }), 'api')).toBe(false);
  });
});
