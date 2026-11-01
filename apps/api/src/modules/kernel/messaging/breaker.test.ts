import { describe, expect, it, vi } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type { BreakerStateStore } from './breaker.js';
import { BreakerOpen, BreakerSender, memoryBreakerStateStore } from './breaker.js';
import type { MessageSender, SendTemplateInput } from './message-sender.js';

// PLAT-9 plan 2.1, 2.5; integrations §2.4: a breaker per provider, shared with the OTP door.

const input: SendTemplateInput = {
  to: '+966500000001',
  templateKey: 'auth_otp',
  locale: 'ar',
  params: { code: '123456' },
  idempotencyKey: '00000000-0000-7000-8000-000000000001',
};
const quiet = { warn: () => undefined, log: () => undefined };

function setup(answer: () => Promise<{ providerMessageId: string }>) {
  let now = 1_000_000;
  const clock = () => now;
  const store = memoryBreakerStateStore(clock);
  const send = vi.fn(answer);
  const inner: MessageSender = {
    channel: 'whatsapp',
    provider: 'stub',
    sendTemplate: send,
    listTemplates: () => Promise.resolve([]),
  };
  const breaker = new BreakerSender(inner, store, {
    threshold: 5,
    openMs: 30_000,
    now: clock,
    logger: quiet,
  });
  return { breaker, store, send, advance: (ms: number) => (now += ms) };
}

const transient = () => Promise.reject(new ProviderFailure('transient', 'down', { status: 503 }));

describe('BreakerSender', () => {
  it('opens after five consecutive transient failures and shares the open state', async () => {
    const { breaker, store, send } = setup(transient);
    for (let index = 0; index < 4; index += 1) {
      await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(ProviderFailure);
      expect(await store.isOpen('stub')).toBe(false);
    }
    await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(ProviderFailure);
    expect(breaker.state).toBe('open');
    expect(await store.isOpen('stub')).toBe(true);
    await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(BreakerOpen);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('lets one trial through after the window; success closes it and clears the shared state', async () => {
    let fail = true;
    const { breaker, store, send, advance } = setup(() =>
      fail ? transient() : Promise.resolve({ providerMessageId: 'm1' }),
    );
    for (let index = 0; index < 5; index += 1) await breaker.sendTemplate(input).catch(() => 0);
    advance(30_001);
    expect(breaker.state).toBe('half_open');
    expect(await store.isOpen('stub')).toBe(false);
    fail = false;
    await expect(breaker.sendTemplate(input)).resolves.toEqual({ providerMessageId: 'm1' });
    expect(breaker.state).toBe('closed');
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('opens again when the trial fails', async () => {
    const { breaker, store, advance } = setup(transient);
    for (let index = 0; index < 5; index += 1) await breaker.sendTemplate(input).catch(() => 0);
    advance(30_001);
    await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(ProviderFailure);
    expect(breaker.state).toBe('open');
    expect(await store.isOpen('stub')).toBe(true);
  });

  it.each(['rate_limited', 'unauthorised', 'permanent'] as const)(
    'does not count a %s answer as an outage',
    async (reason) => {
      const { breaker } = setup(() => Promise.reject(new ProviderFailure(reason, 'no')));
      for (let index = 0; index < 10; index += 1) {
        await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(ProviderFailure);
      }
      expect(breaker.state).toBe('closed');
    },
  );

  it('resets the count on a success', async () => {
    let calls = 0;
    const { breaker } = setup(() =>
      ++calls % 4 === 0 ? Promise.resolve({ providerMessageId: 'ok' }) : transient(),
    );
    for (let index = 0; index < 12; index += 1) await breaker.sendTemplate(input).catch(() => 0);
    expect(breaker.state).toBe('closed');
  });

  it('keeps the send outcome when the shared state cannot be written', async () => {
    const { send } = setup(transient);
    const failing: BreakerStateStore = {
      isOpen: () => Promise.reject(new Error('redis down')),
      markOpen: () => Promise.reject(new Error('redis down')),
      markClosed: () => Promise.reject(new Error('redis down')),
    };
    const breaker = new BreakerSender(
      {
        channel: 'whatsapp',
        provider: 'stub',
        sendTemplate: send,
        listTemplates: () => Promise.resolve([]),
      },
      failing,
      { threshold: 1, logger: quiet },
    );
    await expect(breaker.sendTemplate(input)).rejects.toBeInstanceOf(ProviderFailure);
    expect(breaker.state).toBe('open');
  });
});
