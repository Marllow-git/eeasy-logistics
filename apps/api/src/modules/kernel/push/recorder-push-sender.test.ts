import { defineConfig } from '@eeasy-logistics/config';
import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { ExpoPushSender } from './expo-push-sender.js';
import type { PushMessage } from './push-sender.js';
import { RecorderPushSender, recorderCapacity } from './recorder-push-sender.js';
import { createPushSender } from './senders.js';

// INT-4 plan 2.2, 2.10: the in-memory recorder and the adapter choice.

const message = (to: string): PushMessage => ({
  to,
  title: 'Sync needed',
  body: 'Open the app to sync your data.',
  data: { kind: 'sync', route: 'eeasydriver://sync', push_id: 'p' },
  ttlSeconds: 3600,
  channelId: 'run',
  priority: 'default',
  sound: false,
});

const a = 'ExponentPushToken[aaaaaaaaaaaa]';
const b = 'ExponentPushToken[bbbbbbbbbbbb]';

describe('RecorderPushSender', () => {
  it('records the messages and answers ok tickets with fresh ids and ok receipts', async () => {
    const recorder = new RecorderPushSender();
    const tickets = await recorder.send([message(a), message(b)]);
    expect(recorder.tokens).toEqual([a, b]);
    expect(recorder.messages[0]?.title).toBe('Sync needed');
    expect(tickets.map((t) => t.status)).toEqual(['ok', 'ok']);
    const ids = tickets.flatMap((t) => (t.status === 'ok' ? [t.id] : []));
    expect(new Set(ids).size).toBe(2);
    expect(await recorder.receipts([...ids, 'unknown-ticket'])).toEqual([
      { id: ids[0], status: 'ok' },
      { id: ids[1], status: 'ok' },
      { id: 'unknown-ticket', status: 'ok' },
    ]);
  });

  it('plants a DeviceNotRegistered ticket and receipt per token', async () => {
    const recorder = new RecorderPushSender();
    recorder.planTicketError(b);
    recorder.planReceiptError(a);
    const tickets = await recorder.send([message(a), message(b)]);
    expect(tickets[1]).toEqual({ index: 1, status: 'error', error: 'DeviceNotRegistered' });
    const first = tickets[0];
    if (first?.status !== 'ok') throw new Error('expected an ok ticket');
    expect(await recorder.receipts([first.id])).toEqual([
      { id: first.id, status: 'error', error: 'DeviceNotRegistered' },
    ]);
  });

  it('rate limits the next send only, recording nothing for it', async () => {
    const recorder = new RecorderPushSender();
    recorder.rateLimitNextSend(30);
    await expect(recorder.send([message(a)])).rejects.toMatchObject({
      reason: 'rate_limited',
      retryAfterS: 30,
    });
    expect(recorder.tokens).toEqual([]);
    await expect(recorder.send([message(a)])).resolves.toHaveLength(1);
  });

  it('fails the next send with any planted failure', async () => {
    const recorder = new RecorderPushSender();
    recorder.failNextSend(new ProviderFailure('unauthorised', 'refused', { status: 401 }));
    await expect(recorder.send([message(a)])).rejects.toMatchObject({ reason: 'unauthorised' });
  });

  it('keeps at most its capacity of messages', async () => {
    const recorder = new RecorderPushSender();
    for (let n = 0; n <= recorderCapacity; n += 100) {
      await recorder.send(Array.from({ length: 100 }, () => message(a)));
    }
    expect(recorder.messages).toHaveLength(recorderCapacity);
    recorder.clear();
    expect(recorder.tokens).toEqual([]);
  });

  it('refuses more than 100 messages', async () => {
    const recorder = new RecorderPushSender();
    const batch = Array.from({ length: 101 }, () => message(a));
    await expect(recorder.send(batch)).rejects.toMatchObject({ reason: 'permanent' });
  });
});

describe('createPushSender', () => {
  it('builds the recorder in local and ci by default', () => {
    for (const env of ['local', 'ci']) {
      const choice = createPushSender(defineConfig({ APP_ENV: env }));
      expect(choice.sender).toBeInstanceOf(RecorderPushSender);
    }
  });

  it('builds the Expo adapter for expo', () => {
    const choice = createPushSender(
      defineConfig({ APP_ENV: 'local', PUSH_PROVIDER: 'expo', EXPO_ACCESS_TOKEN: 'fake-token' }),
    );
    expect(choice.sender).toBeInstanceOf(ExpoPushSender);
  });

  it('builds none when push is disabled, without a provider, or for the recorder elsewhere', () => {
    expect(createPushSender(defineConfig({ APP_ENV: 'local', PUSH_DISABLED: 'true' }))).toEqual({
      sender: undefined,
      reason: 'PUSH_DISABLED=true',
    });
    expect(createPushSender(defineConfig({ APP_ENV: 'staging' }))).toEqual({
      sender: undefined,
      reason: 'no PUSH_PROVIDER',
    });
    expect(
      createPushSender(defineConfig({ APP_ENV: 'staging', PUSH_PROVIDER: 'stub' })).sender,
    ).toBeUndefined();
  });
});
