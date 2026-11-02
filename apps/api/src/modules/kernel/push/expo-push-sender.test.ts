import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Secret } from '@eeasy-logistics/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { ExpoPushSender, receiptsPath, retryAfterSeconds, sendPath } from './expo-push-sender.js';
import type { PushMessage } from './push-sender.js';

// INT-4 plan 2.2, 2.10: the Expo adapter against a local HTTP server that answers like the Expo push
// service (Expo Push HTTP API, read 2026-11-02).

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: unknown;
}

type Answer = (seen: Seen, response: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let answer: Answer;
let seen: Seen[] = [];

const json = (response: ServerResponse, status: number, body: unknown, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (raw += chunk));
    request.on('end', () => {
      const entry: Seen = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: raw === '' ? null : (JSON.parse(raw) as unknown),
      };
      seen.push(entry);
      answer(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  answer = (_seen, response) => json(response, 200, { data: [] });
});

const token = (n: number) => `ExponentPushToken[device-${n}-xxxxxxxxxxxx]`;

const message = (n: number, extra: Partial<PushMessage> = {}): PushMessage => ({
  to: token(n),
  title: 'New delivery offer',
  body: 'You have a new offer. Minutes left to accept: 3',
  data: { kind: 'offer', offer_id: '00000000-0000-4000-8000-000000000001', push_id: 'p' },
  ttlSeconds: 180,
  channelId: 'offers',
  priority: 'high',
  sound: true,
  ...extra,
});

const sender = (options: Partial<ConstructorParameters<typeof ExpoPushSender>[0]> = {}) =>
  new ExpoPushSender({ baseUrl, accessToken: new Secret('fake-expo-access-token'), ...options });

async function failureOf(promise: Promise<unknown>): Promise<ProviderFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a ProviderFailure');
}

describe('ExpoPushSender.send', () => {
  it('posts the batch with the headers of the Expo API and maps every field', async () => {
    answer = (_seen, response) =>
      json(response, 200, {
        data: [
          { status: 'ok', id: 'ticket-1' },
          { status: 'ok', id: 'ticket-2' },
        ],
      });
    const tickets = await sender().send([
      message(1),
      message(2, { sound: false, priority: 'default', channelId: 'run', collapseId: 'c-1' }),
    ]);
    expect(tickets).toEqual([
      { index: 0, status: 'ok', id: 'ticket-1' },
      { index: 1, status: 'ok', id: 'ticket-2' },
    ]);
    const [request] = seen;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe(sendPath);
    expect(request?.headers.authorization).toBe('Bearer fake-expo-access-token');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers.accept).toBe('application/json');
    expect(request?.headers['accept-encoding']).toBe('gzip, deflate');
    expect(request?.body).toEqual([
      {
        to: token(1),
        title: 'New delivery offer',
        body: 'You have a new offer. Minutes left to accept: 3',
        data: { kind: 'offer', offer_id: '00000000-0000-4000-8000-000000000001', push_id: 'p' },
        ttl: 180,
        channelId: 'offers',
        priority: 'high',
        sound: 'default',
      },
      {
        to: token(2),
        title: 'New delivery offer',
        body: 'You have a new offer. Minutes left to accept: 3',
        data: { kind: 'offer', offer_id: '00000000-0000-4000-8000-000000000001', push_id: 'p' },
        ttl: 180,
        collapseId: 'c-1',
        channelId: 'run',
        priority: 'default',
        sound: null,
      },
    ]);
  });

  it('sends no authorization header without an access token', async () => {
    answer = (_seen, response) => json(response, 200, { data: [{ status: 'ok', id: 't' }] });
    await new ExpoPushSender({ baseUrl }).send([message(1)]);
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  it('maps a per-message DeviceNotRegistered ticket, in order', async () => {
    answer = (_seen, response) =>
      json(response, 200, {
        data: [
          { status: 'ok', id: 'ticket-1' },
          {
            status: 'error',
            message: `"${token(2)}" is not a registered push notification recipient`,
            details: { error: 'DeviceNotRegistered', expoPushToken: token(2) },
          },
        ],
      });
    const tickets = await sender().send([message(1), message(2)]);
    expect(tickets).toEqual([
      { index: 0, status: 'ok', id: 'ticket-1' },
      { index: 1, status: 'error', error: 'DeviceNotRegistered' },
    ]);
    // The message names the token: it is never carried into the ticket.
    expect(JSON.stringify(tickets)).not.toContain('device-2');
  });

  it('treats an answer without one ticket per message as transient', async () => {
    answer = (_seen, response) => json(response, 200, { data: [{ status: 'ok', id: 't' }] });
    const failure = await failureOf(sender().send([message(1), message(2)]));
    expect(failure.reason).toBe('transient');
  });

  it('maps 429 to rate_limited at Retry-After', async () => {
    answer = (_seen, response) =>
      json(
        response,
        429,
        { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'slow down' }] },
        { 'retry-after': '42' },
      );
    const failure = await failureOf(sender().send([message(1)]));
    expect(failure).toMatchObject({
      reason: 'rate_limited',
      retryAfterS: 42,
      status: 'TOO_MANY_REQUESTS',
    });
  });

  it('maps 429 without Retry-After to rate_limited at 10 s', async () => {
    answer = (_seen, response) => json(response, 429, {});
    const failure = await failureOf(sender().send([message(1)]));
    expect(failure).toMatchObject({ reason: 'rate_limited', retryAfterS: 10, status: 429 });
  });

  it('maps 500 to transient', async () => {
    answer = (_seen, response) => json(response, 500, { errors: [{ code: 'INTERNAL' }] });
    expect((await failureOf(sender().send([message(1)]))).reason).toBe('transient');
  });

  it('maps 400 to permanent with the request error code', async () => {
    answer = (_seen, response) =>
      json(response, 400, {
        errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: `${token(1)} and others` }],
      });
    const failure = await failureOf(sender().send([message(1)]));
    expect(failure).toMatchObject({ reason: 'permanent', status: 'PUSH_TOO_MANY_EXPERIENCE_IDS' });
    expect(failure.message).not.toContain('device-1');
  });

  it.each([401, 403])('maps %s to unauthorised', async (status) => {
    answer = (_seen, response) => json(response, status, { errors: [{ code: 'UNAUTHORIZED' }] });
    const failure = await failureOf(sender().send([message(1)]));
    expect(failure).toMatchObject({ reason: 'unauthorised', status: 'UNAUTHORIZED' });
  });

  it('maps a timeout to transient', async () => {
    answer = (_seen, response) => {
      setTimeout(() => json(response, 200, { data: [{ status: 'ok', id: 't' }] }), 500);
    };
    const failure = await failureOf(sender({ timeoutMs: 50 }).send([message(1)]));
    expect(failure).toMatchObject({ reason: 'transient', status: 'TIMEOUT' });
  });

  it('maps an unreachable service to transient', async () => {
    const failure = await failureOf(
      new ExpoPushSender({ baseUrl: 'http://127.0.0.1:1' }).send([message(1)]),
    );
    expect(failure).toMatchObject({ reason: 'transient', status: 'NETWORK' });
  });

  it('refuses more than 100 messages without a call', async () => {
    const batch = Array.from({ length: 101 }, (_, n) => message(n));
    expect((await failureOf(sender().send(batch))).reason).toBe('permanent');
    expect(seen).toEqual([]);
  });

  it('sends nothing for an empty batch', async () => {
    expect(await sender().send([])).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe('ExpoPushSender.receipts', () => {
  it('posts the ids and maps ok and error receipts, leaving out ids without one', async () => {
    answer = (_seen, response) =>
      json(response, 200, {
        data: {
          'ticket-1': { status: 'ok' },
          'ticket-2': {
            status: 'error',
            message: 'The device cannot receive push notifications anymore',
            details: { error: 'DeviceNotRegistered' },
          },
          'ticket-3': { status: 'error', details: { error: 'Message Too Big!' } },
        },
      });
    const receipts = await sender().receipts(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);
    expect(receipts).toEqual([
      { id: 'ticket-1', status: 'ok' },
      { id: 'ticket-2', status: 'error', error: 'DeviceNotRegistered' },
      { id: 'ticket-3', status: 'error', error: 'unknown' },
    ]);
    expect(seen[0]?.path).toBe(receiptsPath);
    expect(seen[0]?.body).toEqual({ ids: ['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4'] });
    expect(seen[0]?.headers.authorization).toBe('Bearer fake-expo-access-token');
  });

  it('refuses more than 1,000 ids and maps a failed call like send', async () => {
    const ids = Array.from({ length: 1001 }, (_, n) => `t-${n}`);
    expect((await failureOf(sender().receipts(ids))).reason).toBe('permanent');
    answer = (_seen, response) => json(response, 503, {});
    expect((await failureOf(sender().receipts(['t']))).reason).toBe('transient');
  });
});

describe('retryAfterSeconds', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  it('reads delta seconds and HTTP dates, else 10 s', () => {
    expect(retryAfterSeconds('7', now)).toBe(7);
    expect(retryAfterSeconds('0', now)).toBe(1);
    expect(retryAfterSeconds('Mon, 02 Nov 2026 10:00:30 GMT', now)).toBe(30);
    expect(retryAfterSeconds('soon', now)).toBe(10);
    expect(retryAfterSeconds(null, now)).toBe(10);
  });
});
