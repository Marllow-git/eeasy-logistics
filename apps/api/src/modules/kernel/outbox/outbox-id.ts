import { randomBytes } from 'node:crypto';

// Outbox row ids (= envelope ids): UUIDv7 with a 12-bit counter in `rand_a` (RFC 9562 §6.2,
// method 1), so ids minted by one process are strictly increasing even within one millisecond.
// The relay orders a scope by (sequence, id): several events of one change share a sequence and
// come from one transaction, hence one process, so their ids keep the order they were written in.

let lastMs = 0;
let counter = 0;

/** A new UUIDv7, strictly greater than the previous one from this process. */
export function nextOutboxId(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    counter += 1;
    if (counter > 0xfff) {
      // 4,096 ids in one millisecond: borrow the next millisecond rather than wrap.
      lastMs += 1;
      counter = 0;
    }
  }
  const bytes = randomBytes(16);
  let time = lastMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
