import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../src/uuid.ts';

describe('uuidv7', () => {
  it('is a canonical UUID with version 7 and the RFC 9562 variant', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('carries the millisecond timestamp in its first 48 bits', () => {
    const now = Date.UTC(2026, 10, 1, 9, 30, 0, 123);
    const id = uuidv7(now);
    expect(Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)).toBe(now);
  });

  it('sorts by creation time across milliseconds and never repeats', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier < later).toBe(true);
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(1000);
  });

  it('isUuid rejects anything but a canonical lower-case UUID', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid("'; DROP TABLE x; --")).toBe(false);
    expect(isUuid(uuidv7().toUpperCase())).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
