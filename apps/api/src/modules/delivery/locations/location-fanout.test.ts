import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  latestIfNewerCommand,
  latestIfNewerLua,
  latestTtlSeconds,
  RedisLocationFanout,
} from './location-fanout.js';

// DEL-5 adversary round 1, finding 3: the latest hash is written by one Lua script that compares
// the device times first, so a late write never replaces a newer point. A mocked Redis cannot run
// Lua: this checks the script is defined with one key, compares before it writes, and is called
// with the arguments in the order it reads them; locations.http runs the compare on a real Redis.

function fakeRedis() {
  const calls: { command: string; args: unknown[] }[] = [];
  const record =
    (command: string) =>
    (...args: unknown[]) => {
      calls.push({ command, args });
      return chain;
    };
  const chain = {
    elxLatestIfNewer: record(latestIfNewerCommand),
    hset: record('hset'),
    expire: record('expire'),
    publish: record('publish'),
    exec: () => Promise.resolve([]),
  };
  const redis = { on: vi.fn(), defineCommand: vi.fn(), multi: () => chain };
  return { redis, calls };
}

describe('RedisLocationFanout latest hash', () => {
  it('defines the compare-and-set script with one key', () => {
    const { redis } = fakeRedis();
    new RedisLocationFanout(redis as unknown as Redis);
    expect(redis.defineCommand).toHaveBeenCalledWith(latestIfNewerCommand, {
      numberOfKeys: 1,
      lua: latestIfNewerLua,
    });
    // The compare reads the stored `client_ts` and keeps an equal or newer one, before any write.
    expect(latestIfNewerLua).toContain("redis.call('HGET', KEYS[1], 'client_ts')");
    expect(latestIfNewerLua).toContain('if stored and stored >= ARGV[1] then return 0 end');
    expect(latestIfNewerLua.indexOf('>= ARGV[1]')).toBeLessThan(latestIfNewerLua.indexOf('HSET'));
    expect(latestIfNewerLua).toContain("redis.call('EXPIRE', KEYS[1], ARGV[6])");
  });

  it('writes the hash through the script only, then publishes each point', async () => {
    const { redis, calls } = fakeRedis();
    const fanout = new RedisLocationFanout(redis as unknown as Redis);
    await fanout.publish(
      'acc',
      {
        driverId: 'drv',
        lat: 24.7,
        lng: 46.6,
        clientTs: '2026-11-02T08:00:30.000Z',
        serverTs: '2026-11-02T08:00:31.000Z',
        shiftStatus: 'active',
      },
      [{ lat: 24.7, lng: 46.6, clientTs: '2026-11-02T08:00:30.000Z' }],
    );
    expect(calls.map((call) => call.command)).toEqual([latestIfNewerCommand, 'publish']);
    expect(calls[0]?.args).toEqual([
      'elx:loc:latest:acc:drv',
      '2026-11-02T08:00:30.000Z',
      '24.7',
      '46.6',
      '2026-11-02T08:00:31.000Z',
      'active',
      latestTtlSeconds,
    ]);
  });
});
