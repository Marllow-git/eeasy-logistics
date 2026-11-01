import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@eeasy-logistics/db';
import { ApiException } from '../errors/api-exception.js';
import { canonicalJson } from '../idempotency/request-hash.js';
import type { AuditKey } from './audit-log.query.js';

// Opaque list cursors (ADR-0029; contracts README §3 "Pagination"; PLAT-7 plan 2.6): base64url of
// `{ v: 1, k: [occurred_at, id], f: sha256(operation, filters, sort), exp }`, then `.` and an
// HMAC-SHA256 of that text under a key derived from the signing key, so a cursor cannot be forged
// (ADR-0029: "signed by the API"). Valid 24 hours and only with the same operation, filters and
// sort; anything else is `400 validation_failed` on `/query/cursor`.

export const cursorLifetimeSeconds = 24 * 60 * 60;
export const CURSOR_CODEC = Symbol('CURSOR_CODEC');

/** HKDF-SHA256 of the signing key, info `elx-cursor` (a key of its own, not the idempotency one). */
export function cursorHmacKey(signingKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', signingKey, Buffer.alloc(0), 'elx-cursor', 32));
}

/** What a cursor is bound to: the operation, its filters and its sort (never the limit). */
export interface CursorBinding {
  readonly operation: string;
  readonly filters: Readonly<Record<string, string | undefined>>;
  readonly sort: string;
}

function bindingHash(binding: CursorBinding): string {
  const filters = Object.fromEntries(
    Object.entries(binding.filters).filter(([, value]) => value !== undefined),
  );
  return createHash('sha256')
    .update(canonicalJson({ operation: binding.operation, filters, sort: binding.sort }))
    .digest('base64url');
}

const invalidCursor = () =>
  new ApiException('validation_failed', {
    fields: [{ pointer: '/query/cursor', code: 'invalid' }],
  });

interface CursorPayload {
  readonly v: 1;
  readonly k: readonly [string, string];
  readonly f: string;
  readonly exp: number;
}

/** PostgreSQL's text form of a timestamptz (`2026-11-01 10:00:00.123456+03`). */
const timestampText = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2}){0,2}$/;

function isPayload(value: unknown): value is CursorPayload {
  if (value === null || typeof value !== 'object') return false;
  const payload = value as Partial<Record<keyof CursorPayload, unknown>>;
  const key = payload.k;
  return (
    payload.v === 1 &&
    Array.isArray(key) &&
    key.length === 2 &&
    typeof key[0] === 'string' &&
    timestampText.test(key[0]) &&
    typeof key[1] === 'string' &&
    isUuid(key[1]) &&
    typeof payload.f === 'string' &&
    typeof payload.exp === 'number' &&
    Number.isInteger(payload.exp)
  );
}

export class CursorCodec {
  /** `key` undefined (no signing key, outside production only): every cursor is refused. */
  constructor(
    private readonly key: Buffer | undefined,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private sign(text: string): Buffer {
    if (this.key === undefined) throw new ApiException('internal_error');
    return createHmac('sha256', this.key).update(text).digest();
  }

  encode(last: AuditKey, binding: CursorBinding): string {
    const payload: CursorPayload = {
      v: 1,
      k: [last.occurredAt, last.id],
      f: bindingHash(binding),
      exp: this.nowSeconds() + cursorLifetimeSeconds,
    };
    const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${text}.${this.sign(text).toString('base64url')}`;
  }

  /** The key a cursor continues after; refuses a forged, foreign, rebound or expired cursor. */
  decode(cursor: string, binding: CursorBinding): AuditKey {
    const [text, signature, extra] = cursor.split('.');
    if (text === undefined || signature === undefined || extra !== undefined) throw invalidCursor();
    if (this.key === undefined) throw invalidCursor();
    const expected = this.sign(text);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw invalidCursor();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    } catch {
      throw invalidCursor();
    }
    if (!isPayload(payload)) throw invalidCursor();
    if (payload.f !== bindingHash(binding)) throw invalidCursor();
    if (payload.exp <= this.nowSeconds()) throw invalidCursor();
    return { occurredAt: payload.k[0], id: payload.k[1] };
  }
}
