// Bounded request bodies for /monitoring and /ingest (PLAT-14 adversary W-1): the size cap holds
// while the body is read, so a chunked or mislabelled upload is never buffered whole.

/** The parts of a `Request` the reader needs (structural, so tests need no `Request` polyfill). */
export interface BodySource {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type BodyRead =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  /** 411 without a `Content-Length` (the SDKs always send one), 413 over the cap. */
  | { ok: false; status: 411 | 413 };

/**
 * Reads at most `maxBytes` of `request`'s body. A missing or malformed `Content-Length` is refused
 * with 411 before anything is read; a declared length over the cap with 413; and the stream is
 * cancelled with 413 as soon as the running total passes the cap, whatever the header said.
 */
export async function readCappedBody(request: BodySource, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get('content-length');
  if (declared === null || !/^\d{1,12}$/.test(declared)) return { ok: false, status: 411 };
  if (Number(declared) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, status: 413 };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}
