import { describe, expect, it } from 'vitest';
import {
  filterSentryEnvelope,
  isRecipientPath,
  isSecretKey,
  maxEnvelopeBytes,
  redactText,
  scrubAnalyticsEvent,
  scrubPath,
  scrubSentryEvent,
  scrubUrl,
} from '../src/observability';

// PLAT-14 plan 2.7, 2.8, 2.9 (leg 2): what the web apps send to Sentry and PostHog carries no
// cookie, header, body, phone, email, token or recipient token path segment.

// Fake secrets, assembled from parts so the secret scanner of the commit hook sees no literal.
const token = ['Zx81kQ0p', 'R7vW2mN5', 'bT9yL3cJ'].join('');
const phone = '+966501234567';
const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLXZhbHVl'].join(
  '.',
);
const projectKey = `phc_${'AbCdEf0123456789'.repeat(2)}`;
const dsn = 'https://publickey@o1.ingest.example.test/42';

describe('redaction', () => {
  it('rewrites recipient and invitation token segments, keeps ids and templates', () => {
    expect(scrubPath(`/track/${token}`)).toBe('/track/:token');
    expect(scrubPath('/track/short')).toBe('/track/:token');
    expect(scrubPath(`/embed/track/${token}/map`)).toBe('/embed/track/:token/map');
    expect(scrubPath(`/reschedule/${token}`)).toBe('/reschedule/:token');
    expect(scrubPath(`/pin/${token}`)).toBe('/pin/:token');
    expect(scrubPath(`/invitations/${token}`)).toBe('/invitations/:token');
    expect(scrubPath(`/orders/${token}`)).toBe('/orders/:token');
    expect(scrubPath('/track/[token]/census-fault')).toBe('/track/[token]/census-fault');
    expect(scrubPath('/orders/3f2b8c1e-9d4a-4b7e-8f1a-2c3d4e5f6a7b')).toBe(
      '/orders/3f2b8c1e-9d4a-4b7e-8f1a-2c3d4e5f6a7b',
    );
    expect(scrubPath('/settings/notification-preferences')).toBe(
      '/settings/notification-preferences',
    );
  });

  it('keeps only the origin and path of a URL', () => {
    expect(scrubUrl(`https://user:pw@web.example.test/track/${token}?phone=${phone}#x`)).toBe(
      'https://web.example.test/track/:token',
    );
    expect(scrubUrl(`/reschedule/${token}?code=123456`)).toBe('/reschedule/:token');
  });

  it('masks phones to the last four digits and redacts emails, JWTs, credentials and tokens', () => {
    const text = [
      `call ${phone} or 0501234567 or 00966501234567 or 966501234567`,
      'mail sara@example.com',
      `jwt ${jwt}`,
      'Authorization: Bearer abc.def-ghi',
      'token=abcd1234&otp=123456 "password":"hunter2"',
      `segment ${token}`,
      `fetch https://api.example.test/v1/recipient/track/${token}?phone=1`,
    ].join(' | ');
    const result = redactText(text);
    for (const secret of [
      '501234567',
      '0501234567',
      'sara@example.com',
      jwt,
      'abc.def-ghi',
      'abcd1234',
      '123456',
      'hunter2',
      token,
    ]) {
      expect(result).not.toContain(secret);
    }
    expect(result).toContain('[phone …4567]');
    expect(result).toContain('[email]');
    expect(result).toContain('[jwt]');
    expect(result).toContain('https://api.example.test/v1/recipient/track/:token');
  });

  it('redacts values of compound secret keys, by key token (lead review round 2)', () => {
    const text = [
      'client_secret=cs-value-1',
      '"user_password":"up-value-2"',
      'webhook_secret: wh-value-3',
      'signing_key=sk-value-4',
      'db_password=db-value-5',
      'signingKey=sk-value-6 x-api-key: ak-value-7',
    ].join(' ');
    const result = redactText(text);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(result).not.toContain(`value-${n}`);
    expect(result).toContain('client_secret=[redacted]');
    expect(result).toContain('"user_password":"[redacted]');
    expect(result).toContain('webhook_secret: [redacted]');
    expect(redactText('shipping_fee=12 code: internal_error status=failed')).toBe(
      'shipping_fee=12 code: internal_error status=failed',
    );
  });

  it('names secret keys by token, not substring', () => {
    for (const key of [
      'client_secret',
      'user_password',
      'webhook_secret',
      'signing_key',
      'db_password',
      'apiKey',
      'x-api-key',
      'APIKey',
      'otp_code',
      'verification_code',
      'session.id',
      'privateKey',
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
    for (const key of ['shipping_fee', 'spinner', 'keyboard', 'order_id', 'code', 'boundary']) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });

  it('keeps ids, counts, dates and UUIDs', () => {
    const text =
      'order 3f2b8c1e-9d4a-4b7e-8f1a-2c3d4e5f6a7b, 12 items at 2026-11-01T10:00:00Z, #4521';
    expect(redactText(text)).toBe(text);
  });

  it('runs in linear time on long inputs and cuts at 4 kB', () => {
    for (const input of ['a'.repeat(100_000), '5'.repeat(100_000), `${'/a'.repeat(50_000)}`]) {
      const started = performance.now();
      const result = redactText(input);
      expect(performance.now() - started).toBeLessThan(100);
      expect(result.length).toBeLessThanOrEqual(4097);
    }
    expect(redactText(`${'x '.repeat(2047)}${token}`)).not.toContain(token.slice(0, 4));
  });
});

describe('scrubSentryEvent (beforeSend)', () => {
  const planted = {
    event_id: 'a'.repeat(32),
    level: 'error',
    release: 'sha-abc',
    environment: 'ci',
    platform: 'javascript',
    user: { id: 'u1', email: 'sara@example.com', ip_address: '10.0.0.1' },
    breadcrumbs: [{ message: `GET /track/${token}` }],
    extra: { body: '{"phone":"+966501234567"}' },
    transaction: `/track/${token}`,
    request: {
      method: 'POST',
      url: `https://web.example.test/track/${token}?phone=${phone}`,
      headers: {
        Cookie: 'el_staff_at=secret',
        Authorization: 'Bearer x',
        'X-Recipient-Token': token,
      },
      cookies: { el_staff_at: 'secret' },
      data: '{"name":"Sara"}',
      query_string: `phone=${phone}`,
    },
    tags: {
      request_id: '2853647186',
      route: '/track/[token]',
      note: `for ${phone}`,
      'bad key!': 'x',
    },
    contexts: { trace: { trace_id: 'b'.repeat(32) }, browser: { name: 'Chrome' }, state: { a: 1 } },
    exception: {
      values: [
        {
          type: 'Error',
          value: `failed for ${phone} at /track/${token}`,
          mechanism: { type: 'onerror', handled: false, data: { x: 1 } },
          stacktrace: {
            frames: [
              {
                filename: `https://web.example.test/track/${token}`,
                function: 'render',
                lineno: 1,
                vars: { phone },
              },
            ],
          },
        },
      ],
    },
  };

  it('drops cookies, headers, bodies, users, breadcrumbs and extra; redacts the rest', () => {
    const event = scrubSentryEvent(planted);
    const text = JSON.stringify(event);
    for (const secret of [
      'el_staff_at',
      'Bearer',
      'X-Recipient-Token',
      token,
      '501234567',
      'Sara',
      'sara@example.com',
      '10.0.0.1',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('breadcrumbs');
    expect(event).not.toHaveProperty('extra');
    expect(event).not.toHaveProperty('transaction');
    expect(event.request).toEqual({ method: 'POST', url: 'https://web.example.test/track/:token' });
    expect(event.tags).toEqual({
      request_id: '2853647186',
      route: '/track/[token]',
      note: 'for [phone …4567]',
    });
    expect(Object.keys(event.contexts)).toEqual(['trace', 'browser']);
    expect(event.exception.values[0]).toEqual({
      type: 'Error',
      value: 'failed for [phone …4567] at /track/:token',
      mechanism: { type: 'onerror', handled: false },
      stacktrace: {
        frames: [
          { function: 'render', lineno: 1, filename: 'https://web.example.test/track/:token' },
        ],
      },
    });
    expect(event).toMatchObject({ release: 'sha-abc', environment: 'ci', level: 'error' });
  });
});

describe('filterSentryEnvelope (/monitoring)', () => {
  const encode = (lines: unknown[]) =>
    new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join('\n'));
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  it('forwards events for the configured DSN, scrubbed, and drops other item types', () => {
    const event = JSON.stringify(planted());
    const body = new TextEncoder().encode(
      [
        JSON.stringify({
          event_id: 'e1',
          dsn,
          sent_at: '2026-11-01T00:00:00Z',
          trace: { user_segment: 'x' },
        }),
        JSON.stringify({ type: 'event', length: new TextEncoder().encode(event).byteLength }),
        event,
        JSON.stringify({ type: 'replay_event' }),
        JSON.stringify({ phone }),
        JSON.stringify({ type: 'client_report' }),
        JSON.stringify({ discarded_events: [] }),
      ].join('\n'),
    );
    const decision = filterSentryEnvelope(body, dsn);
    expect(decision.kind).toBe('forward');
    if (decision.kind !== 'forward') return;
    expect(decision.url).toBe('https://o1.ingest.example.test/api/42/envelope/');
    const lines = decode(decision.body).split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ dsn, event_id: 'e1', sent_at: '2026-11-01T00:00:00Z' });
    const itemTypes = lines
      .slice(1)
      .filter((_, index) => index % 2 === 0)
      .map((line) => (JSON.parse(line) as { type: string }).type);
    expect(itemTypes).toEqual(['event', 'client_report']);
    expect(decode(decision.body)).not.toContain('el_staff_at');
    expect(decode(decision.body)).not.toContain('501234567');
    expect(decode(decision.body)).not.toContain(token);

    function planted() {
      return {
        event_id: 'e1',
        request: { url: `https://web.example.test/track/${token}`, cookies: { el_staff_at: 's' } },
        exception: { values: [{ type: 'Error', value: `x ${phone}` }] },
      };
    }
  });

  it('refuses another DSN, a malformed envelope and an oversized body; drops empty envelopes', () => {
    const other = encode([
      { dsn: 'https://publickey@o1.ingest.example.test/43' },
      { type: 'event' },
      {},
    ]);
    expect(filterSentryEnvelope(other, dsn)).toEqual({ kind: 'reject', status: 400 });
    const otherKey = encode([{ dsn: 'https://otherkey@o1.ingest.example.test/42' }]);
    expect(filterSentryEnvelope(otherKey, dsn)).toEqual({ kind: 'reject', status: 400 });
    const otherHost = encode([{ dsn: 'https://publickey@evil.example.test/42' }]);
    expect(filterSentryEnvelope(otherHost, dsn)).toEqual({ kind: 'reject', status: 400 });
    expect(filterSentryEnvelope(new TextEncoder().encode('not json'), dsn)).toEqual({
      kind: 'reject',
      status: 400,
    });
    const tooLong = encode([{ dsn }, { type: 'event', length: 10_000 }, {}]);
    expect(filterSentryEnvelope(tooLong, dsn)).toEqual({ kind: 'reject', status: 400 });
    expect(filterSentryEnvelope(new Uint8Array(maxEnvelopeBytes + 1), dsn)).toEqual({
      kind: 'reject',
      status: 413,
    });
    const sessionOnly = encode([{ dsn }, { type: 'session' }, { sid: 'x' }]);
    expect(filterSentryEnvelope(sessionOnly, dsn)).toEqual({ kind: 'drop' });
  });
});

describe('scrubAnalyticsEvent (before_send)', () => {
  it('rewrites URLs, redacts strings, keeps SDK ids and drops person properties', () => {
    const capture = {
      event: '$pageview',
      properties: {
        token: projectKey,
        distinct_id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
        $current_url: `https://web.example.test/track/${token}?phone=${phone}&name=Sara`,
        $pathname: `/track/${token}`,
        $referrer: `https://wa.me/966501234567?text=${token}`,
        $title: `Order for ${phone}`,
        nested: { list: [`sara@example.com`] },
        count: 3,
      },
      $set: { email: 'sara@example.com' },
      $set_once: { $initial_current_url: `/track/${token}` },
    };
    const result = scrubAnalyticsEvent(capture);
    const text = JSON.stringify(result);
    for (const secret of [token, '501234567', 'Sara', 'sara@example.com']) {
      expect(text).not.toContain(secret);
    }
    expect(result?.properties).toMatchObject({
      token: projectKey,
      distinct_id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      $current_url: 'https://web.example.test/track/:token',
      $pathname: '/track/:token',
      $referrer: 'https://wa.me/:phone',
      $title: 'Order for [phone …4567]',
      count: 3,
    });
    expect(result).not.toHaveProperty('$set');
    expect(result).not.toHaveProperty('$set_once');
    expect(scrubAnalyticsEvent(null)).toBeNull();
  });

  it('drops secret-named keys at any depth, before any value scrub (lead review round 2)', () => {
    const result = scrubAnalyticsEvent({
      event: 'shell.error_page.shown',
      properties: {
        client_secret: 'zq-planted',
        boundary: 'segment',
        nested: { webhook_secret: 'zq-planted', kept: 1, list: [{ db_password: 'zq-planted' }] },
        $session_id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      },
    });
    expect(result?.properties).toEqual({
      boundary: 'segment',
      nested: { kept: 1, list: [{}] },
      $session_id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
    });
    expect(JSON.stringify(result)).not.toContain('zq-planted');
  });

  it('knows the recipient paths', () => {
    expect(isRecipientPath('/track/abc')).toBe(true);
    expect(isRecipientPath('/embed/track/abc')).toBe(true);
    expect(isRecipientPath('/reschedule/abc')).toBe(true);
    expect(isRecipientPath('/pin/abc')).toBe(true);
    expect(isRecipientPath('/')).toBe(false);
    expect(isRecipientPath('/tracking-settings')).toBe(false);
  });
});
