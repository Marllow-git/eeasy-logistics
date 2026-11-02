import { describe, expect, it, vi } from 'vitest';

// `platformListConsumers` without the queues (lead ruling on WEB-4 8.3 #2): an API run without
// `REDIS_URL` (the census lane) answers the database counts, `parked` 0, never a 500.

const parkedRows = vi.fn();
vi.mock('../src/modules/kernel/platform/outbox.repository.js', () => ({
  currentPlatformOutbox: () => ({
    parkedRows,
    consumerStats: () => Promise.resolve({ lagSeconds: 42, dead: 3 }),
  }),
  platformReplayStore: vi.fn(),
}));

const { PlatformOutboxController } =
  await import('../src/modules/kernel/outbox/platform-outbox.controller.js');

describe('platformListConsumers without Redis', () => {
  it('answers the database counts with parked 0 and reads no parked rows', async () => {
    const controller = new PlatformOutboxController({ record: vi.fn() } as never, undefined, null);
    const list = await controller.listConsumers();
    expect(list.data?.length).toBeGreaterThan(0);
    for (const entry of list.data ?? []) {
      expect(entry).toMatchObject({ lag_seconds: 42, dead: 3, parked: 0 });
    }
    expect(parkedRows).not.toHaveBeenCalled();
  });
});
