import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { classifyReply, normaliseWord } from '../opt-out-list.js';
import { EngineCallbackDoor, advances } from './callback-door.js';

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
      optOuts: { add: vi.fn(), remove: vi.fn() },
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
