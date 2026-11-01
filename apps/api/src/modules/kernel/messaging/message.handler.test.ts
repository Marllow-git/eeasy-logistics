import { createCredentialsCipher } from '@eeasy-logistics/config';
import { Secret } from '@eeasy-logistics/config';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import type { OutboxRow } from '../outbox/kind-handlers.js';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { BreakerOpen } from './breaker.js';
import { engineUnavailable } from './engine/engine-message-sender.js';
import type { MessageSender, SendTemplateInput } from './message-sender.js';

type SendMock = Mock<MessageSender['sendTemplate']>;
import { MessageSenders } from './message-sender.js';
import type { SenderResolver } from './message.handler.js';
import { MessageKindHandler, platformOnlyResolver } from './message.handler.js';

// PLAT-9 item F (plan 2.5, 2A.1): the `message` handler decrypts at send time, resolves the engine
// sender, sends, and maps failures to outcomes.

const cipher = createCredentialsCipher({
  keys: { k1: new Secret(Buffer.alloc(32, 3).toString('base64')) },
  activeKeyId: 'k1',
});
const challenge = '019a3f00-0000-7000-8000-0000000000c1';
const platformRoute = {
  engineAccountId: 1,
  senderInstanceId: '00000000-0000-4000-8000-000000000001',
};
const quiet = { log: () => undefined, warn: () => undefined };

function otpRow(overrides: Partial<OutboxRow> = {}, code = '482913'): OutboxRow {
  const blob = cipher.encrypt(code, `core_otp_challenges:${challenge}`).blob.toString('base64');
  return {
    id: '019a3f00-0000-7000-8000-000000000001',
    accountId: null,
    attempts: 0,
    deferrals: 0,
    createdAt: new Date(),
    payload: {
      channel: 'whatsapp',
      template_key: 'auth_otp',
      to: '+966500000123',
      locale: 'ar',
      challenge_id: challenge,
      params: { code: { encrypted: blob } },
    },
    ...overrides,
  } as OutboxRow;
}

function fakeSender(channel: 'whatsapp' | 'mail', send: SendMock = vi.fn()) {
  send.mockImplementation((input: SendTemplateInput) =>
    Promise.resolve({ providerMessageId: input.idempotencyKey, providerState: 'accepted' }),
  );
  const sender: MessageSender = {
    channel,
    provider: channel === 'mail' ? 'smtp' : 'engine',
    sendTemplate: send,
    listTemplates: () => Promise.resolve([]),
  };
  return { sender, send };
}

function handlerWith(
  options: { send?: SendMock; resolver?: SenderResolver; noCipher?: boolean } = {},
) {
  const whatsapp = fakeSender('whatsapp', options.send);
  const mail = fakeSender('mail');
  const senders = new MessageSenders({
    whatsapp: whatsapp.sender,
    mail: mail.sender,
    platformRoute,
  });
  const handler = new MessageKindHandler({
    senders,
    cipher: options.noCipher === true ? null : cipher,
    resolver: options.resolver ?? platformOnlyResolver(senders),
    logger: quiet,
  });
  return { handler, send: whatsapp.send, mailSend: mail.send };
}

describe('MessageKindHandler (plan 2.5, 2A.1)', () => {
  it('decrypts the code at send time and sends the OTP through the platform sender', async () => {
    const { handler, send } = handlerWith();
    expect(await handler.execute(otpRow())).toEqual({ outcome: 'done' });
    expect(send).toHaveBeenCalledWith({
      to: '+966500000123',
      templateKey: 'auth_otp',
      locale: 'ar',
      params: { code: '482913' },
      idempotencyKey: '019a3f00-0000-7000-8000-000000000001',
      route: platformRoute,
      checkFirst: false,
    });
  });

  it('asks the engine first when the row was tried before', async () => {
    const { handler, send } = handlerWith();
    await handler.execute(otpRow({ attempts: 1 }));
    await handler.execute(otpRow({ deferrals: 2 }));
    expect(send.mock.calls.map(([input]) => input.checkFirst)).toEqual([true, true]);
  });

  it('sends a mail row through the mail adapter with no engine route', async () => {
    const { handler, mailSend } = handlerWith();
    const row = otpRow({
      accountId: '019a3f00-0000-7000-8000-0000000000a1',
      payload: {
        channel: 'mail',
        template_key: 'password_reset',
        to: 'someone@example.test',
        locale: 'en',
        params: { link: 'https://app.example.test/reset/x' },
      },
    });
    expect(await handler.execute(row)).toEqual({ outcome: 'done' });
    const input = mailSend.mock.calls[0]?.[0] as SendTemplateInput;
    expect(input.route).toBeUndefined();
    expect(input.params).toEqual({ link: 'https://app.example.test/reset/x' });
  });

  it('skips an account message with no linked sender as done, reason no_sender (plan 2A.4)', async () => {
    const { handler, send } = handlerWith({
      resolver: { resolve: () => Promise.resolve('no_sender') },
    });
    expect(await handler.execute(otpRow())).toEqual({ outcome: 'done', skipped: 'no_sender' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown template', { template_key: 'marketing_blast' }],
    ['a wrong channel', { channel: 'mail' }],
    ['a bad locale', { locale: 'fr' }],
  ])('makes a row with %s dead without sending', async (_name, change) => {
    const { handler, send } = handlerWith();
    const row = otpRow();
    const outcome = await handler.execute({
      ...row,
      payload: { ...(row.payload as object), ...change },
    });
    expect(outcome.outcome).toBe('dead');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['a code in clear', { code: '123456' }],
    ['a code under another context', 'other'],
    ['no code', {}],
  ])('makes an OTP row with %s dead, never sending it', async (_name, params) => {
    const { handler, send } = handlerWith();
    const row = otpRow();
    const other = cipher
      .encrypt('111111', 'core_otp_challenges:someone-else')
      .blob.toString('base64');
    const outcome = await handler.execute({
      ...row,
      payload: {
        ...(row.payload as object),
        params: params === 'other' ? { code: { encrypted: other } } : params,
      },
    });
    expect(outcome).toMatchObject({ outcome: 'dead', error: { status: 'params' } });
    expect(JSON.stringify(outcome)).not.toMatch(/\d{6}/);
    expect(send).not.toHaveBeenCalled();
  });

  it('cannot send an OTP without credentials keys', async () => {
    const { handler } = handlerWith({ noCipher: true });
    expect((await handler.execute(otpRow())).outcome).toBe('dead');
  });

  it('waits without an attempt while the breaker is open or the engine is unreachable', async () => {
    const breaker: SendMock = vi.fn();
    const { handler: open } = handlerWith({ send: breaker });
    breaker.mockReset();
    breaker.mockRejectedValue(new BreakerOpen('engine'));
    expect(await open.execute(otpRow())).toMatchObject({
      outcome: 'retry',
      consumesAttempt: false,
      error: { status: 'breaker_open' },
    });
    const down: SendMock = vi.fn();
    const { handler: unreachable } = handlerWith({ send: down });
    down.mockReset();
    down.mockRejectedValue(
      new ProviderFailure('transient', 'the engine is unreachable', { status: engineUnavailable }),
    );
    expect(await unreachable.execute(otpRow())).toMatchObject({
      outcome: 'retry',
      consumesAttempt: false,
      error: { status: engineUnavailable },
    });
  });

  it('lets a refusal through to the outbox (dead by failureOutcome)', async () => {
    const refusing: SendMock = vi.fn();
    const { handler } = handlerWith({ send: refusing });
    refusing.mockReset();
    refusing.mockRejectedValue(
      new ProviderFailure('permanent', 'refused', { status: 'BINDING_MISMATCH' }),
    );
    await expect(handler.execute(otpRow())).rejects.toMatchObject({ reason: 'permanent' });
  });
});

describe('platformOnlyResolver (plan 2A.4)', () => {
  const resolver = platformOnlyResolver({ platformRoute });

  it('gives OTP and platform-only rows the platform sender', async () => {
    expect(await resolver.resolve(null, 'auth_otp')).toEqual(platformRoute);
    expect(await resolver.resolve('019a3f00-0000-7000-8000-0000000000a1', 'auth_otp')).toEqual(
      platformRoute,
    );
  });

  it('never gives an account’s own message the platform sender', async () => {
    expect(await resolver.resolve('019a3f00-0000-7000-8000-0000000000a1', 'invitation')).toBe(
      'no_sender',
    );
  });
});
