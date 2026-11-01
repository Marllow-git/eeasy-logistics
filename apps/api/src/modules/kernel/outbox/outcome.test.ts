import { describe, expect, it } from 'vitest';
import {
  failureOutcome,
  formatLastError,
  maxLastErrorLength,
  maxDeferrals,
  redactErrorMessage,
  resolveOutcome,
} from './outcome.js';
import { ProviderFailure } from './provider-failure.js';
import { baseDelayMs, outboxQueuePolicies } from './queue-options.js';

// PLAT-8 item E: the outcome rules (plan 2.5; integrations §4.2, §4.4).

const now = new Date('2026-11-01T12:00:00Z');
const row = (attempts: number, ageMs = 0, deferrals = 0) => ({
  attempts,
  deferrals,
  createdAt: new Date(now.getTime() - ageMs),
});
const internal = outboxQueuePolicies.internal_event;
const half = () => 0.5;

describe('last_error redaction', () => {
  it('removes bearer tokens, JWTs and secret-named values anywhere in the message', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const message =
      `upstream refused Authorization: Bearer abc.def-123, token=${jwt} ` +
      `api_key=s3cr3t {"password":"hunter2"} order_id=42`;
    const clean = redactErrorMessage(message);
    for (const secret of ['abc.def-123', jwt, 's3cr3t', 'hunter2']) {
      expect(clean).not.toContain(secret);
    }
    expect(clean).toContain('order_id=42');
    expect(clean).toContain('upstream refused');
  });

  it('removes quoted values with spaces or commas, URL user-info, Basic and Digest credentials (adversary L-1)', () => {
    const cases: [string, string][] = [
      ['rejected password="correct horse, battery" for user', 'correct horse, battery'],
      ["rejected {'client_secret': 'a b,c'} ok", 'a b,c'],
      ['GET https://svc-user:p4ss-w0rd@api.example.com/v1 failed', 'p4ss-w0rd'],
      ['Authorization: Basic dXNlcjpwYXNz rejected', 'dXNlcjpwYXNz'],
      [
        'Authorization: Digest username="bob", realm="x", response="6629fae49393a053" rejected',
        '6629fae49393a053',
      ],
    ];
    for (const [message, secret] of cases) {
      const clean = redactErrorMessage(message);
      expect(clean, message).not.toContain(secret);
      expect(clean, message).toContain('[redacted]');
    }
    expect(redactErrorMessage('GET https://svc-user:pw@api.example.com/v1')).toBe(
      'GET https://[redacted]@api.example.com/v1',
    );
    // A quoted value of a harmless name stays.
    expect(redactErrorMessage('status="not found, retry later"')).toBe(
      'status="not found, retry later"',
    );
  });

  it('drops control characters and caps the length', () => {
    expect(redactErrorMessage('a\nb\u0000c')).toBe('a b c');
    expect(Array.from(redactErrorMessage('x'.repeat(5_000)))).toHaveLength(maxLastErrorLength);
  });

  it('puts the provider status first', () => {
    expect(formatLastError({ status: 503, message: 'Service Unavailable' })).toBe(
      '503 Service Unavailable',
    );
    expect(formatLastError({ message: 'no status' })).toBe('no status');
  });
});

describe('failure outcomes (integrations §4.2)', () => {
  it('rate_limited retries at the provider time without consuming an attempt', () => {
    expect(
      failureOutcome(
        new ProviderFailure('rate_limited', 'slow down', { status: 429, retryAfterS: 7 }),
      ),
    ).toEqual({
      outcome: 'retry',
      consumesAttempt: false,
      retryAfterS: 7,
      error: { status: 429, message: 'slow down' },
    });
  });

  it('unauthorised retries in an hour without consuming an attempt', () => {
    expect(failureOutcome(new ProviderFailure('unauthorised', 'revoked', { status: 401 }))).toEqual(
      {
        outcome: 'retry',
        consumesAttempt: false,
        retryAfterS: 3_600,
        error: { status: 401, message: 'revoked' },
      },
    );
  });

  it('permanent is dead, transient and unexpected errors consume an attempt', () => {
    expect(
      failureOutcome(new ProviderFailure('permanent', 'bad request', { status: 422 })),
    ).toEqual({ outcome: 'dead', error: { status: 422, message: 'bad request' } });
    expect(failureOutcome(new ProviderFailure('transient', 'reset'))).toMatchObject({
      outcome: 'retry',
      consumesAttempt: true,
    });
    expect(failureOutcome(new TypeError('boom'))).toEqual({
      outcome: 'retry',
      consumesAttempt: true,
      error: { message: 'TypeError: boom' },
    });
  });
});

describe('resolveOutcome', () => {
  it('writes done and superseded as they are', () => {
    expect(resolveOutcome(row(0), { outcome: 'done' }, internal, now)).toEqual({ status: 'done' });
    expect(
      resolveOutcome(row(0), { outcome: 'superseded', reason: 'newer message' }, internal, now),
    ).toEqual({ status: 'superseded', lastError: 'newer message' });
  });

  it('retries on the kind schedule with jitter and counts the attempt', () => {
    const write = resolveOutcome(
      row(2),
      { outcome: 'retry', consumesAttempt: true, error: { status: 500, message: 'oops' } },
      internal,
      now,
      half,
    );
    // Third failure: base 4 s (1 s doubling), half of it with the pinned jitter.
    expect(write).toEqual({
      status: 'enqueued',
      attempts: 3,
      nextAttemptAt: new Date(now.getTime() + 2_000),
      lastError: '500 oops',
      parkedConsumers: null,
      deferrals: 0,
    });
  });

  it('keeps the attempt count and honours retryAfterS when the attempt is not consumed', () => {
    const write = resolveOutcome(
      row(9),
      { outcome: 'retry', consumesAttempt: false, retryAfterS: 30 },
      internal,
      now,
      half,
    );
    expect(write).toEqual({
      status: 'enqueued',
      attempts: 9,
      nextAttemptAt: new Date(now.getTime() + 30_000),
      lastError: null,
      parkedConsumers: null,
      deferrals: 1,
    });
    // A park names its consumers for `parked_consumers` (lead review round 3).
    const park = resolveOutcome(
      row(9),
      {
        outcome: 'retry',
        consumesAttempt: false,
        retryAfterS: 30,
        error: { message: 'parked: sequence gap' },
        parked: { consumers: ['kernel.a', 'kernel.b'], since: now },
      },
      internal,
      now,
    );
    expect(park).toMatchObject({
      status: 'enqueued',
      attempts: 9,
      lastError: 'parked: sequence gap',
      parkedConsumers: ['kernel.a', 'kernel.b'],
    });
    // `retry_after 0` is floored at the kind's first step and a second (adversary M-4).
    const zero = resolveOutcome(
      row(0),
      { outcome: 'retry', consumesAttempt: false, retryAfterS: 0 },
      internal,
      now,
    );
    expect(zero).toMatchObject({ status: 'enqueued', deferrals: 1 });
    expect(zero.status === 'enqueued' && zero.nextAttemptAt.getTime() - now.getTime()).toBe(1_000);
    const carrier = resolveOutcome(
      row(0),
      { outcome: 'retry', consumesAttempt: false, retryAfterS: 0 },
      outboxQueuePolicies.carrier_call,
      now,
    );
    expect(carrier.status === 'enqueued' && carrier.nextAttemptAt.getTime() - now.getTime()).toBe(
      baseDelayMs(outboxQueuePolicies.carrier_call.backoff, 1),
    );
    // A provider asking for a week gets a day; a nonsense value falls back to the schedule.
    const week = resolveOutcome(
      row(0),
      { outcome: 'retry', consumesAttempt: false, retryAfterS: 7 * 86_400 },
      internal,
      now,
    );
    expect(week.status === 'enqueued' && week.nextAttemptAt.getTime() - now.getTime()).toBe(
      86_400_000,
    );
  });

  it('caps retries that consume no attempt at 50 and ages them out on a time budget (adversary M-4)', () => {
    const limited = { outcome: 'retry', consumesAttempt: false, retryAfterS: 5 } as const;
    expect(resolveOutcome(row(0, 0, maxDeferrals - 1), limited, internal, now)).toMatchObject({
      status: 'enqueued',
      deferrals: maxDeferrals,
    });
    expect(resolveOutcome(row(0, 0, maxDeferrals), limited, internal, now)).toEqual({
      status: 'dead',
      attempts: 0,
      lastError: 'too many deferrals',
    });
    const webhook = outboxQueuePolicies.webhook;
    expect(resolveOutcome(row(0, 24 * 3_600_000), limited, webhook, now)).toEqual({
      status: 'dead',
      attempts: 0,
      lastError: 'retry budget spent',
    });
    expect(resolveOutcome(row(0, 23 * 3_600_000), limited, webhook, now).status).toBe('enqueued');
  });

  it('is dead at the budget: the 10th failure of internal_event, or 24 h for webhook', () => {
    const failure = { outcome: 'retry', consumesAttempt: true, error: { message: 'x' } } as const;
    expect(resolveOutcome(row(8), failure, internal, now).status).toBe('enqueued');
    expect(resolveOutcome(row(9), failure, internal, now)).toEqual({
      status: 'dead',
      attempts: 10,
      lastError: 'x',
    });
    const webhook = outboxQueuePolicies.webhook;
    expect(resolveOutcome(row(40, 23 * 3_600_000), failure, webhook, now).status).toBe('enqueued');
    expect(resolveOutcome(row(1, 24 * 3_600_000), failure, webhook, now).status).toBe('dead');
    // A failure that does not consume an attempt never kills the row.
    expect(
      resolveOutcome(row(9), { outcome: 'retry', consumesAttempt: false }, internal, now).status,
    ).toBe('enqueued');
  });

  it('writes a handler dead outcome with its error redacted', () => {
    expect(
      resolveOutcome(
        row(1),
        { outcome: 'dead', error: { status: 400, message: 'secret=abc' } },
        internal,
        now,
      ),
    ).toEqual({ status: 'dead', attempts: 1, lastError: '400 secret=[redacted]' });
  });
});
