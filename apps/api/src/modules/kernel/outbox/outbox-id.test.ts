import { isUuid } from '@eeasy-logistics/db';
import { describe, expect, it } from 'vitest';
import { nextOutboxId } from './outbox-id.js';

describe('nextOutboxId (UUIDv7, monotonic per process)', () => {
  it('is a version 7, variant 10 UUID carrying the millisecond', () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const id = nextOutboxId(now + 10_000_000);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now + 10_000_000);
  });

  it('strictly increases within one millisecond, past the 12-bit counter, and if the clock steps back', () => {
    const base = Date.UTC(2027, 0, 1);
    const ids = [
      ...Array.from({ length: 5000 }, () => nextOutboxId(base)),
      nextOutboxId(base - 1000),
      nextOutboxId(base + 5),
    ];
    for (let index = 1; index < ids.length; index += 1) {
      expect((ids[index] ?? '') > (ids[index - 1] ?? '')).toBe(true);
    }
  });
});
