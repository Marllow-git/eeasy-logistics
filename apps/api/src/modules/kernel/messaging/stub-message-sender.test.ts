import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type { SendTemplateInput } from './message-sender.js';
import {
  StubMessageSender,
  StubRefused,
  httpFailure,
  providerTimeoutMs,
} from './stub-message-sender.js';

// PLAT-9 item B against a fake HTTP server: the request the stub adapter sends, the failure kinds
// it reports (ADR-0036), the 5 s timeout (integrations §2.4) and the refusal outside local and ci.

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

const received: Received[] = [];
let answer: (res: ServerResponse) => void = (res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'stub-message-1' }));
};
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
      });
      answer(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const input: SendTemplateInput = {
  to: '+966500000001',
  templateKey: 'auth_otp',
  locale: 'en',
  params: { code: '482913' },
  idempotencyKey: '00000000-0000-7000-8000-000000000001',
};

const sender = (options: { timeoutMs?: number } = {}) =>
  new StubMessageSender({ appEnv: 'ci', url, templateNamespace: 'elx', ...options });

describe('StubMessageSender', () => {
  it('posts the template, its parameters, the rendered text and the row id as client reference', async () => {
    received.length = 0;
    await expect(sender().sendTemplate(input)).resolves.toEqual({
      providerMessageId: 'stub-message-1',
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe('/v1/messages');
    expect(received[0]?.headers['content-type']).toBe('application/json');
    expect(received[0]?.body).toEqual({
      to: '+966500000001',
      template: 'elx_auth_otp',
      template_key: 'auth_otp',
      locale: 'en',
      params: { code: '482913' },
      text: '482913 is your verification code. For your security, do not share this code.',
      client_reference: input.idempotencyKey,
    });
  });

  it.each([
    [429, 'rate_limited', { retryAfterS: 7 }],
    [401, 'unauthorised', {}],
    [403, 'unauthorised', {}],
    [400, 'permanent', {}],
    [500, 'transient', {}],
    [503, 'transient', {}],
  ] as const)('reports HTTP %i as %s', async (status, reason, extra) => {
    answer = (res) => {
      res.writeHead(status, status === 429 ? { 'retry-after': '7' } : {});
      res.end('{}');
    };
    const failure = await sender()
      .sendTemplate(input)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderFailure);
    expect(failure).toMatchObject({ reason, status, ...extra });
  });

  it('times out as a transient failure', async () => {
    answer = () => undefined; // never answers
    const started = Date.now();
    const failure = await sender({ timeoutMs: 150 })
      .sendTemplate(input)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: 'transient', status: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('waits 5 s by default (integrations §2.4)', () => {
    expect(providerTimeoutMs).toBe(5_000);
  });

  it('reports an unreachable stub as transient', async () => {
    const closed = new StubMessageSender({
      appEnv: 'local',
      url: 'http://127.0.0.1:9',
      templateNamespace: 'elx',
    });
    await expect(closed.sendTemplate(input)).rejects.toMatchObject({
      reason: 'transient',
      status: 'network',
    });
  });

  it('refuses a mail template', async () => {
    await expect(
      sender().sendTemplate({ ...input, templateKey: 'password_reset', params: { link: 'x' } }),
    ).rejects.toMatchObject({ reason: 'permanent' });
  });

  it.each(['staging', 'production'] as const)('refuses to be built in %s', (appEnv) => {
    expect(
      () =>
        new StubMessageSender({ appEnv, url: 'http://127.0.0.1:8080', templateNamespace: 'elx' }),
    ).toThrow(StubRefused);
  });

  it('lists the WhatsApp templates in both locales', async () => {
    expect(await sender().listTemplates()).toEqual([
      { key: 'auth_otp', locale: 'ar', status: 'approved', category: 'authentication' },
      { key: 'auth_otp', locale: 'en', status: 'approved', category: 'authentication' },
    ]);
  });
});

describe('httpFailure', () => {
  it('ignores a malformed Retry-After', () => {
    expect(httpFailure(429, 'soon').retryAfterS).toBeUndefined();
  });
});
