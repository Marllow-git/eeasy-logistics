import { describe, expect, it } from 'vitest';
import { readCappedBody } from '../src/observability';

// Adversary W-1 (PLAT-14 leg 2): /monitoring and /ingest read their bodies through this reader, so
// the size cap holds while reading and a chunked or mislabelled upload is never buffered whole.

/** A body that yields `chunks` of `size` bytes and records how far it was read and cancelled. */
function trackedBody(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const headers = (values: Record<string, string>) => new Headers(values);

describe('readCappedBody', () => {
  it('reads a body within the cap', async () => {
    const { stream } = trackedBody(3, 10);
    const read = await readCappedBody(
      { headers: headers({ 'content-length': '30' }), body: stream },
      100,
    );
    expect(read).toEqual({ ok: true, body: new Uint8Array(30).fill(0x61) });
  });

  it('cancels a body that passes the cap while streaming, whatever its declared length', async () => {
    // 1,000 chunks of 1 kB announced as 10 bytes: the reader stops after the cap, not at the end.
    const { stream, state } = trackedBody(1000, 1024);
    const read = await readCappedBody(
      { headers: headers({ 'content-length': '10' }), body: stream },
      4096,
    );
    expect(read).toEqual({ ok: false, status: 413 });
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(6);
  });

  it('refuses a declared length over the cap before reading', async () => {
    const { stream, state } = trackedBody(10, 1024);
    const read = await readCappedBody(
      { headers: headers({ 'content-length': '10240' }), body: stream },
      4096,
    );
    expect(read).toEqual({ ok: false, status: 413 });
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(state.cancelled).toBe(true);
  });

  it('refuses a body without a Content-Length (chunked) with 411, unread', async () => {
    for (const value of [undefined, '', '-1', '1e9', 'abc']) {
      const { stream, state } = trackedBody(10, 1024);
      const read = await readCappedBody(
        { headers: headers(value === undefined ? {} : { 'content-length': value }), body: stream },
        4096,
      );
      expect(read, String(value)).toEqual({ ok: false, status: 411 });
      expect(state.pulled, String(value)).toBeLessThanOrEqual(1);
    }
  });
});
