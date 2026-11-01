import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { MessagingRepository, MessagingStore } from '../../platform/messaging.repository.js';
import { OptOutList, classifyReply, normaliseWord } from '../opt-out-list.js';
import { EngineCallbackDoor, advances } from './callback-door.js';
import {
  engineCallbackPath,
  engineServiceIdentity,
  signedHeaders,
  wireInstant,
} from './envelope.js';

// PLAT-9 item G: the monotonic message state of the callback door (engine contract §5.2) and the
// stop and start words of the opt-out list (integrations §5.5; ADR-0041 union).

describe('advances (engine contract §5.2)', () => {
  const t0 = new Date('2026-11-01T10:00:00Z');
  const t1 = new Date('2026-11-01T10:00:05Z');

  it('applies the first state and every step forward', () => {
    expect(advances(null, null, 'accepted', t0)).toBe(true);
    expect(advances('accepted', t0, 'sent', t1)).toBe(true);
    expect(advances('sent', t0, 'delivered', t1)).toBe(true);
    expect(advances('delivered', t0, 'read', t1)).toBe(true);
    expect(advances('queued', t0, 'failed', t1)).toBe(true);
  });

  it('never lowers a receipt, even when it arrives later', () => {
    expect(advances('read', t0, 'delivered', t1)).toBe(false);
    expect(advances('read', t0, 'sent', t1)).toBe(false);
    expect(advances('delivered', t0, 'sent', t1)).toBe(false);
  });

  it('never leaves a terminal failure', () => {
    for (const terminal of ['failed', 'expired', 'suppressed'] as const) {
      expect(advances(terminal, t0, 'delivered', t1)).toBe(false);
      expect(advances(terminal, t0, 'queued', t1)).toBe(false);
      expect(advances(terminal, t0, 'expired', t1)).toBe(false);
    }
    expect(advances('sent', t0, 'failed', t1)).toBe(false);
  });

  it('orders in-flight states of one rank by time', () => {
    expect(advances('queued', t0, 'held_connection', t1)).toBe(true);
    expect(advances('held_connection', t1, 'queued', t0)).toBe(false);
  });
});

describe('opt-out words (integrations §5.5; ADR-0041)', () => {
  it.each(['STOP', 'stop', ' Stop ', 'إيقاف', 'الغاء', 'إلغاء'])('reads %j as stop', (text) => {
    expect(classifyReply(text)).toBe('stop');
  });

  it.each(['START', 'start', 'اشتراك', 'تشغيل'])('reads %j as start', (text) => {
    expect(classifyReply(text)).toBe('start');
  });

  it.each(['stop please', 'please stop', 'شكرا', '', 'STOPP'])('reads %j as nothing', (text) => {
    expect(classifyReply(text)).toBeNull();
  });

  it('treats the alef forms alike', () => {
    expect(normaliseWord('إلغاء')).toBe(normaliseWord('الغاء'));
  });
});

describe('refusal logging (adversary L-1)', () => {
  it('logs the first refusal of a code in a minute at warn, the rest at debug', async () => {
    let now = Date.parse('2026-11-01T10:00:00Z');
    const logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const door = new EngineCallbackDoor({
      settings: { keyId: 'k', secret: 's'.repeat(32), platformInstanceId: undefined },
      store: { run: () => Promise.reject(new Error('never reached')) },
      optOuts: { applySuppression: vi.fn() },
      now: () => now,
      logger,
    });
    const forged = () =>
      door.receive({
        method: 'POST',
        path: '/internal/whatsapp/v1/callbacks',
        headers: { 'content-length': '2', 'x-eeasy-service': 'someone' },
        body: Readable.from([Buffer.from('{}')]),
      });
    for (let index = 0; index < 3; index += 1) expect((await forged()).status).toBe(401);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledTimes(2);
    now += 60_000;
    await forged();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('suppression.changed (lead review of PLAT-9: one transaction, every E.164 number)', () => {
  const key = { service: engineServiceIdentity, keyId: 'k', secret: 's'.repeat(32) };
  const accountId = '0192f000-0000-7000-8000-000000000001';
  const instance = randomUUID();

  const setup = () => {
    const repo = {
      reserveNonce: vi.fn(() => Promise.resolve(true)),
      ownerOfInstance: vi.fn(() => Promise.resolve({ accountId, engineAccountId: 7 })),
      claimCallback: vi.fn(() => Promise.resolve(true)),
      addOptOut: vi.fn(() => Promise.resolve()),
      removeOptOut: vi.fn(() => Promise.resolve()),
    };
    let runs = 0;
    const store: MessagingStore = {
      run: (fn) => {
        runs += 1;
        return fn(repo as unknown as MessagingRepository);
      },
    };
    const door = new EngineCallbackDoor({
      settings: { keyId: key.keyId, secret: key.secret, platformInstanceId: randomUUID() },
      store,
      optOuts: new OptOutList(store),
      logger: { log: vi.fn(), warn: vi.fn() },
    });
    const send = (customerNumber: string, suppressed: boolean) => {
      const raw = JSON.stringify({
        callback: 'suppression.changed',
        eeasy_account_id: 7,
        sender_instance_id: instance,
        customer_number: customerNumber,
        suppressed,
        occurred_at: wireInstant(Date.now()),
        callback_id: randomUUID(),
      });
      return door.receive({
        method: 'POST',
        path: engineCallbackPath,
        headers: {
          ...signedHeaders(key, 'POST', engineCallbackPath, raw),
          'content-length': String(Buffer.byteLength(raw)),
        },
        body: Readable.from([Buffer.from(raw)]),
      });
    };
    return { repo, send, runs: () => runs };
  };

  it('writes the opt-out in the callback transaction, opening no second unit of work', async () => {
    const { repo, send, runs } = setup();
    expect(await send('+966500000777', true)).toEqual({ status: 200, body: { ok: true } });
    // One unit of work for the nonce (step 8), one for the claim and the opt-out together.
    expect(runs()).toBe(2);
    expect(repo.addOptOut).toHaveBeenCalledWith(accountId, '+966500000777', 'provider');
    expect(await send('+966500000777', false)).toEqual({ status: 200, body: { ok: true } });
    expect(runs()).toBe(4);
    expect(repo.removeOptOut).toHaveBeenCalledWith(accountId, '+966500000777');
  });

  it('records a number our phone metadata does not know under the engine’s E.164 string', async () => {
    const { repo, send } = setup();
    // Country code 999 is unassigned: `normalisePhone` refuses it, the suppression still holds.
    expect(await send('+999123456789', true)).toEqual({ status: 200, body: { ok: true } });
    expect(repo.addOptOut).toHaveBeenCalledWith(accountId, '+999123456789', 'provider');
    expect(await send('+999123456789', false)).toEqual({ status: 200, body: { ok: true } });
    expect(repo.removeOptOut).toHaveBeenCalledWith(accountId, '+999123456789');
  });

  it.each(['+1234567', '+1234567890123456', '+0123456789'])(
    'refuses %j, which is not E.164-shaped (422), and writes nothing',
    async (number) => {
      const { repo, send } = setup();
      const answer = await send(number, true);
      expect(answer).toEqual({
        status: 422,
        body: { ok: false, error: { code: 'SCHEMA_INVALID' } },
      });
      expect(repo.addOptOut).not.toHaveBeenCalled();
    },
  );
});
