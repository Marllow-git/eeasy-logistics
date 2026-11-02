import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxRow } from '../outbox/kind-handlers.js';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from '../telemetry/metrics.js';
import { PushTokenInvalidations } from './invalidations.js';
import type { NewPushTicket, PushTicketWriter } from './push.handler.js';
import { PushKindHandler, unauthorisedRetryS } from './push.handler.js';
import { RecorderPushSender } from './recorder-push-sender.js';

// INT-4 plan 2.3, 2.9, 2.10: the `push` handler validates the row, renders, sends one batch, keeps
// the tickets and hands DeviceNotRegistered to the registry; failures map to the outbox outcomes.

const rowId = '019a4000-0000-7000-8000-000000000001';
const account = '019a4000-0000-7000-8000-0000000000a1';
const offer = '019a4000-0000-7000-8000-0000000000f1';
const order = '019a4000-0000-7000-8000-0000000000e1';
const deviceA = '019a4000-0000-7000-8000-0000000000d1';
const deviceB = '019a4000-0000-7000-8000-0000000000d2';
const tokenA = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const tokenB = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const now = new Date('2026-11-02T10:00:00Z');

const offerPayload = (overrides: Record<string, unknown> = {}) => ({
  driver_id: '019a4000-0000-7000-8000-0000000000c1',
  template: 'offer_received',
  params: { expires_in_min: '3' },
  locale: 'ar',
  data: { kind: 'offer', offer_id: offer, route: `eeasydriver://offers/${offer}` },
  ttl_s: 600,
  collapse_id: `offer:${offer}`,
  expires_at: '2026-11-02T10:03:00Z',
  devices: [
    { device_id: deviceA, push_token: tokenA },
    { device_id: deviceB, push_token: tokenB },
  ],
  ...overrides,
});

const row = (payload: unknown, overrides: Partial<OutboxRow> = {}): OutboxRow =>
  ({
    id: rowId,
    kind: 'push',
    accountId: account,
    attempts: 0,
    deferrals: 0,
    createdAt: now,
    payload,
    ...overrides,
  }) as OutboxRow;

function setup() {
  const recorder = new RecorderPushSender();
  const written: { accountId: string; tickets: readonly NewPushTicket[] }[] = [];
  const tickets: PushTicketWriter = {
    insertTickets: (accountId, rows) => {
      written.push({ accountId, tickets: rows });
      return Promise.resolve();
    },
  };
  const lines: string[] = [];
  const logger = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
  const invalidations = new PushTokenInvalidations(logger);
  const invalidated: string[] = [];
  invalidations.register((i) => {
    invalidated.push(`${i.accountId}/${i.deviceId}/${i.reason}`);
    return Promise.resolve();
  });
  const handler = new PushKindHandler({
    sender: recorder,
    tickets,
    invalidations,
    now: () => now,
    logger,
  });
  return { handler, recorder, written, lines, invalidated };
}

/** No token, title, body or data value in any log line. */
function expectNothingPrivate(lines: readonly string[]) {
  const text = lines.join('\n');
  for (const secret of [tokenA, tokenB, 'aaaaaaaa', 'عرض', 'Minutes left', offer]) {
    expect(text).not.toContain(secret);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PushKindHandler: delivery', () => {
  it('sends one message per device with the rendered texts and ids-only data, keeps the tickets', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    const { handler, recorder, written, lines } = setup();
    expect(await handler.execute(row(offerPayload()))).toEqual({ outcome: 'done' });
    expect(recorder.tokens).toEqual([tokenA, tokenB]);
    const [message] = recorder.messages;
    expect(message).toEqual({
      to: tokenA,
      title: 'عرض توصيل جديد',
      body: 'وصلك عرض جديد. الدقائق المتبقية للقبول: 3',
      data: {
        kind: 'offer',
        route: `eeasydriver://offers/${offer}`,
        offer_id: offer,
        push_id: rowId,
      },
      // The offer expires in 3 minutes: the push service gives up then too.
      ttlSeconds: 180,
      collapseId: `offer:${offer}`,
      channelId: 'offers',
      priority: 'high',
      sound: true,
    });
    expect(written).toHaveLength(1);
    expect(written[0]?.accountId).toBe(account);
    expect(written[0]?.tickets.map((t) => [t.outboxId, t.deviceId])).toEqual([
      [rowId, deviceA],
      [rowId, deviceB],
    ]);
    expect(add).toHaveBeenCalledWith('push_messages_total', 2, { outcome: 'sent' });
    expect(lines).toEqual([`push sent outbox_id=${rowId} devices=2 ok=2 unregistered=0 errors=0`]);
    expectNothingPrivate(lines);
  });

  it('renders in English for an English row, and a run change silently on `run`', async () => {
    const { handler, recorder } = setup();
    const payload = offerPayload({
      template: 'order_assigned',
      params: { order_number: 'D-000123' },
      locale: 'en',
      data: { kind: 'assignment', order_id: order, route: `eeasydriver://orders/${order}` },
      expires_at: undefined,
      collapse_id: undefined,
    });
    expect(await handler.execute(row(payload))).toEqual({ outcome: 'done' });
    expect(recorder.messages[0]).toMatchObject({
      title: 'New order on your run',
      body: 'Order D-000123 was assigned to you.',
      ttlSeconds: 600,
      channelId: 'run',
      priority: 'default',
      sound: false,
      data: { kind: 'assignment', order_id: order, push_id: rowId },
    });
    expect(recorder.messages[0]).not.toHaveProperty('collapseId');
  });

  it('hands a DeviceNotRegistered ticket to the registry once, keeps the other ticket, and is done', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    const { handler, recorder, written, invalidated, lines } = setup();
    recorder.planTicketError(tokenB);
    expect(await handler.execute(row(offerPayload()))).toEqual({ outcome: 'done' });
    expect(invalidated).toEqual([`${account}/${deviceB}/device_not_registered`]);
    expect(written[0]?.tickets.map((t) => t.deviceId)).toEqual([deviceA]);
    expect(add).toHaveBeenCalledWith('push_messages_total', 1, {
      outcome: 'device_not_registered',
    });
    expect(lines).toContain(
      `push token invalidated device_id=${deviceB} reason=device_not_registered handlers=1`,
    );
    expectNothingPrivate(lines);
  });

  it('counts other ticket errors as permanent and logs their name only', async () => {
    const { handler, recorder, lines } = setup();
    recorder.planTicketError(tokenA, 'MessageTooBig');
    expect(await handler.execute(row(offerPayload()))).toEqual({ outcome: 'done' });
    expect(lines).toContain(`push ticket error outbox_id=${rowId} error=MessageTooBig count=1`);
  });

  it('sends once to two device rows that share a token', async () => {
    const { handler, recorder } = setup();
    const devices = [
      { device_id: deviceA, push_token: tokenA },
      { device_id: deviceB, push_token: tokenA },
    ];
    await handler.execute(row(offerPayload({ devices })));
    expect(recorder.tokens).toEqual([tokenA]);
  });
});

describe('PushKindHandler: skips', () => {
  it('drops an expired offer as done `stale`, without a send', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    const { handler, recorder } = setup();
    const outcome = await handler.execute(
      row(offerPayload({ expires_at: '2026-11-02T09:59:59Z' })),
    );
    expect(outcome).toEqual({ outcome: 'done', skipped: 'stale' });
    expect(recorder.tokens).toEqual([]);
    expect(add).toHaveBeenCalledWith('push_messages_total', 1, { outcome: 'stale' });
  });

  it('is done `no_device` for a driver without a device token', async () => {
    const { handler, recorder } = setup();
    const outcome = await handler.execute(row(offerPayload({ devices: [] })));
    expect(outcome).toEqual({ outcome: 'done', skipped: 'no_device' });
    expect(recorder.tokens).toEqual([]);
  });
});

describe('PushKindHandler: refusals are dead at once', () => {
  const dead = {
    outcome: 'dead',
    error: { status: 'payload', message: 'push payload is invalid' },
  };
  const cases: [string, unknown][] = [
    ['not an object', 'push'],
    ['an unknown template', offerPayload({ template: 'welcome' })],
    ['an unknown locale', offerPayload({ locale: 'fr' })],
    ['a driver id that is not a UUID', offerPayload({ driver_id: '42' })],
    ['an unknown kind', offerPayload({ data: { kind: 'promo', route: 'eeasydriver://sync' } })],
    [
      'a data value that is not a UUID',
      offerPayload({ data: { kind: 'offer', offer_id: 'o-1', route: 'eeasydriver://offers/o-1' } }),
    ],
    [
      'an extra data field',
      offerPayload({
        data: {
          kind: 'offer',
          offer_id: offer,
          route: `eeasydriver://offers/${offer}`,
          recipient_phone: '+966500000000',
        },
      }),
    ],
    [
      'a route outside the four deep links',
      offerPayload({ data: { kind: 'sync', route: 'https://evil.example/sync' } }),
    ],
    [
      'a route that does not match the kind',
      offerPayload({ data: { kind: 'offer', offer_id: offer, route: 'eeasydriver://cash' } }),
    ],
    [
      'a route for another id',
      offerPayload({
        data: { kind: 'offer', offer_id: offer, route: `eeasydriver://offers/${order}` },
      }),
    ],
    ['an offer without expires_at', offerPayload({ expires_at: undefined })],
    ['a ttl of 0', offerPayload({ ttl_s: 0 })],
    ['a ttl over 30 days', offerPayload({ ttl_s: 2_592_001 })],
    ['a collapse id with spaces', offerPayload({ collapse_id: 'a b' })],
    [
      'a token that is not an Expo push token',
      offerPayload({ devices: [{ device_id: deviceA, push_token: 'fcm:abcdef' }] }),
    ],
    [
      'a device id that is not a UUID',
      offerPayload({ devices: [{ device_id: 'phone-1', push_token: tokenA }] }),
    ],
    [
      'more than 100 devices',
      offerPayload({
        devices: Array.from({ length: 101 }, () => ({ device_id: deviceA, push_token: tokenA })),
      }),
    ],
    ['an extra top-level field', offerPayload({ recipient_name: 'Sara' })],
  ];

  it.each(cases)('refuses %s', async (_name, payload) => {
    const { handler, recorder } = setup();
    expect(await handler.execute(row(payload))).toEqual(dead);
    expect(recorder.tokens).toEqual([]);
  });

  it('refuses an undeclared, missing or malformed parameter with the parameter name only', async () => {
    const { handler, recorder } = setup();
    expect(
      await handler.execute(row(offerPayload({ params: { expires_in_min: '3', name: 'Sara' } }))),
    ).toEqual({ outcome: 'dead', error: { status: 'params', message: 'unknown parameter name' } });
    expect(await handler.execute(row(offerPayload({ params: {} })))).toEqual({
      outcome: 'dead',
      error: { status: 'params', message: 'parameter expires_in_min is missing' },
    });
    expect(
      await handler.execute(row(offerPayload({ params: { expires_in_min: '3 min' } }))),
    ).toMatchObject({ outcome: 'dead' });
    expect(recorder.tokens).toEqual([]);
  });

  it('refuses a row without an account', async () => {
    const { handler } = setup();
    expect(await handler.execute(row(offerPayload(), { accountId: null }))).toEqual({
      outcome: 'dead',
      error: { status: 'payload', message: 'a push belongs to an account' },
    });
  });
});

describe('PushKindHandler: provider failures', () => {
  it('reschedules a rate limit at Retry-After without an attempt', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    const { handler, recorder } = setup();
    recorder.rateLimitNextSend(42);
    expect(await handler.execute(row(offerPayload()))).toEqual({
      outcome: 'retry',
      consumesAttempt: false,
      retryAfterS: 42,
      error: { status: 429, message: 'the push service is rate limiting' },
    });
    expect(add).toHaveBeenCalledWith('push_messages_total', 2, { outcome: 'rate_limited' });
  });

  it('waits 5 minutes without an attempt when our access token is refused, with one warning', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    const { handler, recorder, lines } = setup();
    recorder.failNextSend(
      new ProviderFailure('unauthorised', 'the push service refused our access token', {
        status: 'UNAUTHORIZED',
      }),
    );
    expect(await handler.execute(row(offerPayload()))).toEqual({
      outcome: 'retry',
      consumesAttempt: false,
      retryAfterS: unauthorisedRetryS,
      error: { status: 'UNAUTHORIZED', message: 'the push service refused our access token' },
    });
    expect(unauthorisedRetryS).toBe(300);
    expect(lines).toEqual([
      `push service refused our access token outbox_id=${rowId} status=UNAUTHORIZED`,
    ]);
    expect(add).toHaveBeenCalledWith('push_messages_total', 2, { outcome: 'unauthorised' });
  });

  it('is dead on a permanent failure', async () => {
    const { handler, recorder } = setup();
    recorder.failNextSend(new ProviderFailure('permanent', 'refused', { status: 400 }));
    expect(await handler.execute(row(offerPayload()))).toEqual({
      outcome: 'dead',
      error: { status: 400, message: 'refused' },
    });
  });

  it('retries a transient failure with an attempt', async () => {
    const { handler, recorder } = setup();
    recorder.failNextSend(
      new ProviderFailure('transient', 'the push service failed', { status: 503 }),
    );
    expect(await handler.execute(row(offerPayload()))).toEqual({
      outcome: 'retry',
      consumesAttempt: true,
      error: { status: 503, message: 'the push service failed' },
    });
  });

  it('rethrows an unexpected error for the worker to retry with an attempt', async () => {
    const written: unknown[] = [];
    const failing = new PushKindHandler({
      sender: {
        provider: 'stub',
        send: () => Promise.reject(new TypeError('boom')),
        receipts: () => Promise.resolve([]),
      },
      tickets: {
        insertTickets: (_account, rows) => {
          written.push(rows);
          return Promise.resolve();
        },
      },
      invalidations: new PushTokenInvalidations({ log: () => undefined, warn: () => undefined }),
      now: () => now,
    });
    await expect(failing.execute(row(offerPayload()))).rejects.toThrow('boom');
    expect(written).toEqual([]);
  });

  it('does not hand on an unregistered device when keeping the tickets fails (the retry will)', async () => {
    const { recorder, invalidated } = setup();
    const invalidations = new PushTokenInvalidations({
      log: () => undefined,
      warn: () => undefined,
    });
    const seen: string[] = [];
    invalidations.register((i) => {
      seen.push(i.deviceId);
      return Promise.resolve();
    });
    recorder.planTicketError(tokenB);
    const handler = new PushKindHandler({
      sender: recorder,
      tickets: { insertTickets: () => Promise.reject(new Error('database down')) },
      invalidations,
      now: () => now,
    });
    await expect(handler.execute(row(offerPayload()))).rejects.toThrow('database down');
    expect(seen).toEqual([]);
    expect(invalidated).toEqual([]);
  });
});

describe('PushKindHandler: ordering', () => {
  it('needs no ordering scope (integrations §4.1)', () => {
    const { handler } = setup();
    expect(handler.orderingKey({} as never)).toBeNull();
  });
});
