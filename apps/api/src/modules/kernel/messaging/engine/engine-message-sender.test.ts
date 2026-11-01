import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '../../outbox/provider-failure.js';
import type { SendTemplateInput } from '../message-sender.js';
import { EngineMessageSender, StubRefused, engineUnavailable } from './engine-message-sender.js';
import {
  bodySha256,
  canonicalString,
  engineCommandPath,
  signCanonical,
  signatureMatches,
} from './envelope.js';

// PLAT-9 item F (plan 2A.1): the engine adapter's signed commands, their shape, the resend check
// and the mapping of the engine's answers to the outbox's failure kinds.

const key = {
  service: 'eeasy-laravel-control-plane',
  keyId: 'test-command',
  secret: 'fake-command-secret-0123456789abcdef0123',
};
const now = Date.parse('2026-11-01T10:00:00Z');
const rowId = '019a3f00-0000-7000-8000-000000000001';
const route = { engineAccountId: 1, senderInstanceId: '00000000-0000-4000-8000-000000000001' };
const otp: SendTemplateInput = {
  to: '+966500000123',
  templateKey: 'auth_otp',
  locale: 'en',
  params: { code: '731904' },
  idempotencyKey: rowId,
  route,
};

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly raw: string;
  readonly body: Record<string, unknown> & { payload: Record<string, unknown> };
}

/** A fake engine: records each request and answers with the next scripted reply. */
function fakeEngine(...replies: (Response | Error | ((seen: Seen) => Response))[]) {
  const seen: Seen[] = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const entry = {
      url,
      headers: init?.headers as Record<string, string>,
      raw,
      body: JSON.parse(raw) as Seen['body'],
    };
    seen.push(entry);
    const reply = replies.shift() ?? ok({ status: 'accepted' });
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(typeof reply === 'function' ? reply(entry) : reply);
  };
  const sender = new EngineMessageSender({
    provider: 'engine',
    appEnv: 'production',
    baseUrl: 'https://wa-engine.internal:8790',
    key,
    now: () => now,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { sender, seen };
}

function ok(result: Record<string, unknown>): Response {
  return Response.json({ ok: true, command: 'x', result, engine_build_sha: 's', server_time: 't' });
}

function refused(status: number, code: string, retryable = false): Response {
  return Response.json({ ok: false, error: { code, message: 'refused', retryable } }, { status });
}

describe('EngineMessageSender (plan 2A.1)', () => {
  it('sends an OTP as a signed message.send.verification for the platform sender', async () => {
    const { sender, seen } = fakeEngine();
    const sent = await sender.sendTemplate(otp);
    expect(sent).toEqual({ providerMessageId: rowId, providerState: 'accepted' });
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.url).toBe(`https://wa-engine.internal:8790${engineCommandPath}`);
    expect(request?.body).toEqual({
      command: 'message.send.verification',
      eeasy_account_id: 1,
      eeasy_store_id: null,
      sender_instance_id: route.senderInstanceId,
      eeasy_message_id: rowId,
      message_type: 'verification',
      priority_class: 1,
      expires_at: '2026-11-01T10:10:00Z',
      idempotency_key: rowId,
      payload: {
        to_number: '+966500000123',
        body: '731904 is your verification code. For your security, do not share this code.\n\nThis code expires in 5 minutes.',
        locale: 'en',
        lane_key: '+966500000123',
        suppression_check: false,
      },
    });
  });

  it('signs the eight-line canonical string with the command secret (contract §2.2)', async () => {
    const { sender, seen } = fakeEngine();
    await sender.sendTemplate(otp);
    const headers = seen[0]?.headers ?? {};
    expect(headers['x-eeasy-service']).toBe(key.service);
    expect(headers['x-eeasy-key-id']).toBe(key.keyId);
    expect(headers['x-eeasy-timestamp']).toBe('2026-11-01T10:00:00Z');
    expect(headers['x-eeasy-nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(headers['x-eeasy-body-sha256']).toBe(bodySha256(seen[0]?.raw ?? ''));
    const expected = signCanonical(
      canonicalString({
        method: 'POST',
        path: engineCommandPath,
        service: key.service,
        keyId: key.keyId,
        timestamp: headers['x-eeasy-timestamp'] ?? '',
        nonce: headers['x-eeasy-nonce'] ?? '',
        bodySha256: headers['x-eeasy-body-sha256'] ?? '',
      }),
      key.secret,
    );
    expect(signatureMatches(expected, headers['x-eeasy-signature'] ?? '')).toBe(true);
  });

  it('uses a fresh nonce on every request, the same idempotency key on a retry', async () => {
    const { sender, seen } = fakeEngine(
      refused(503, 'ENGINE_UNAVAILABLE'),
      ok({ status: 'queued' }),
    );
    await expect(sender.sendTemplate(otp)).rejects.toBeInstanceOf(ProviderFailure);
    await sender.sendTemplate(otp);
    expect(seen[0]?.headers['x-eeasy-nonce']).not.toBe(seen[1]?.headers['x-eeasy-nonce']);
    expect(seen[0]?.body.idempotency_key).toBe(seen[1]?.body.idempotency_key);
  });

  it('asks message.status first on a retry and does not send what the engine holds', async () => {
    const { sender, seen } = fakeEngine(ok({ exists: true, status: 'sent' }));
    const sent = await sender.sendTemplate({ ...otp, checkFirst: true });
    expect(sent.providerState).toBe('sent');
    expect(seen.map((request) => request.body.command)).toEqual(['message.status']);
    expect(seen[0]?.body).toMatchObject({
      message_type: null,
      priority_class: null,
      expires_at: null,
      idempotency_key: null,
      payload: {},
    });
  });

  it('sends after message.status when the engine does not know the message', async () => {
    const { sender, seen } = fakeEngine(ok({ exists: false }), ok({ status: 'accepted' }));
    await sender.sendTemplate({ ...otp, checkFirst: true });
    expect(seen.map((request) => request.body.command)).toEqual([
      'message.status',
      'message.send.verification',
    ]);
  });

  it.each([
    [refused(401, 'AUTH_BAD_SIGNATURE'), 'unauthorised', 'AUTH_BAD_SIGNATURE'],
    [refused(422, 'BINDING_MISMATCH'), 'permanent', 'BINDING_MISMATCH'],
    [refused(422, 'EXPIRY_MISMATCH'), 'permanent', 'EXPIRY_MISMATCH'],
    [refused(409, 'EVENT_ALREADY_SENT'), 'permanent', 'EVENT_ALREADY_SENT'],
    [refused(422, 'SOMETHING', true), 'transient', 'SOMETHING'],
    [refused(502, 'ENGINE_UNAVAILABLE'), 'transient', engineUnavailable],
    [new Response('down', { status: 500 }), 'transient', engineUnavailable],
    [new TypeError('fetch failed'), 'transient', engineUnavailable],
  ] as const)('maps an engine answer to the outbox (%#)', async (reply, reason, status) => {
    const { sender } = fakeEngine(reply);
    const failure = await sender.sendTemplate(otp).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderFailure);
    expect(failure).toMatchObject({ reason, status });
  });

  it('refuses a send without an engine sender, before any request', async () => {
    const { sender, seen } = fakeEngine();
    const { route: _route, ...withoutRoute } = otp;
    void _route;
    await expect(sender.sendTemplate(withoutRoute)).rejects.toMatchObject({
      reason: 'permanent',
      status: 'no_route',
    });
    expect(seen).toHaveLength(0);
  });

  it('refuses a mail template on the WhatsApp adapter', async () => {
    const { sender } = fakeEngine();
    await expect(
      sender.sendTemplate({ ...otp, templateKey: 'password_reset', params: { link: 'x' } }),
    ).rejects.toMatchObject({ reason: 'permanent', status: 'template' });
  });

  it.each(['staging', 'production'] as const)('refuses the stub provider in %s', (appEnv) => {
    expect(
      () =>
        new EngineMessageSender({
          provider: 'stub',
          appEnv,
          baseUrl: 'http://127.0.0.1:8080',
          key,
        }),
    ).toThrow(StubRefused);
  });

  it('refuses plain http off loopback (contract §2.8)', () => {
    expect(
      () =>
        new EngineMessageSender({
          provider: 'engine',
          appEnv: 'production',
          baseUrl: 'http://wa-engine.internal:8790',
          key,
        }),
    ).toThrow(/https/);
  });

  it('lists the local WhatsApp templates in both locales (ADR-0041)', async () => {
    const { sender } = fakeEngine();
    const list = await sender.listTemplates();
    expect(list.map((entry) => `${entry.key}:${entry.locale}`).sort()).toEqual([
      'auth_otp:ar',
      'auth_otp:en',
    ]);
  });
});
