import type { Principal } from '../auth/principal.js';
import { defaultSecretFields } from './request-hash.js';

// Idempotent writes (PLAT-6 plan 2.8; data §5.1; contracts README §3 Idempotency; K-8). The
// reserve runs in the request's transaction, before the handler; the response is stored by the
// same transaction. A failed request rolls back its reserve, so a retry runs again.

export const IDEMPOTENT = Symbol('elx:idempotent');
export const idempotencyKeyHeader = 'idempotency-key';
export const replayedHeader = 'Idempotency-Replayed';
/** How long a stored response answers replays (data §5.1). */
export const idempotencyTtlHours = 24;

export interface IdempotentOptions {
  /** Request and response fields never stored or hashed bare (default README §3's list). */
  readonly secretFields?: readonly string[];
  /**
   * The response carries a one-time secret (API key, webhook secret, tracking link): it is stored
   * without the secret fields and a replay answers `409 secret_already_issued` with
   * `details.resource_id` instead of the body.
   */
  readonly secretResponse?: boolean;
}

export interface ResolvedIdempotentOptions {
  readonly secretFields: readonly string[];
  readonly secretResponse: boolean;
}

/** What a reserve writes: who, which key, which request. */
export interface IdempotencyClaim {
  readonly principalType: 'staff' | 'driver' | 'platform';
  readonly principalId: string;
  readonly key: string;
  readonly route: string;
  readonly requestHash: Buffer;
}

export interface StoredKey {
  readonly id: string;
  readonly requestHash: Buffer;
  readonly state: 'in_progress' | 'completed';
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
  readonly expired: boolean;
}

/**
 * The storage of one unit of work: the tenant store (account rows, the cross-tenant door included)
 * or the platform store (account NULL). All calls run in the request's transaction.
 */
export interface IdempotencyStore {
  /** A transaction-scoped try-lock on the principal's key; false while another request holds it. */
  lock(principalId: string, key: string): Promise<boolean>;
  /** Inserts `in_progress`; returns its id, or undefined when the key already exists. */
  insert(claim: IdempotencyClaim): Promise<string | undefined>;
  find(principalId: string, key: string): Promise<StoredKey | undefined>;
  /** Reuses an expired row that the purge has not removed yet, as a fresh `in_progress`. */
  restart(id: string, claim: IdempotencyClaim): Promise<void>;
  complete(id: string, status: number, body: unknown): Promise<void>;
}

export type ReserveOutcome =
  | { readonly kind: 'reserved'; readonly id: string }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'reused' };

/**
 * The reserve of data §5.1. The try-lock makes a concurrent duplicate answer at once instead of
 * waiting on the first request's uncommitted row: whoever holds the lock is still running
 * (`in_progress`); once it commits, the row is there and answers the replay.
 */
export async function reserve(
  store: IdempotencyStore,
  claim: IdempotencyClaim,
): Promise<ReserveOutcome> {
  if (!(await store.lock(claim.principalId, claim.key))) return { kind: 'in_progress' };
  const id = await store.insert(claim);
  if (id !== undefined) return { kind: 'reserved', id };
  const existing = await store.find(claim.principalId, claim.key);
  if (existing === undefined) return { kind: 'in_progress' };
  if (existing.expired) {
    await store.restart(existing.id, claim);
    return { kind: 'reserved', id: existing.id };
  }
  if (!existing.requestHash.equals(claim.requestHash)) return { kind: 'reused' };
  if (existing.state !== 'completed' || existing.responseStatus === null) {
    return { kind: 'in_progress' };
  }
  return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
}

/** Who the key belongs to: the user for staff and platform, the device for a driver. */
export function principalKey(
  principal: Principal,
): Pick<IdempotencyClaim, 'principalType' | 'principalId'> {
  return principal.kind === 'driver'
    ? { principalType: 'driver', principalId: principal.deviceId }
    : { principalType: principal.kind, principalId: principal.userId };
}

export function resolveOptions(options: IdempotentOptions = {}): ResolvedIdempotentOptions {
  return {
    secretFields: options.secretFields ?? defaultSecretFields,
    secretResponse: options.secretResponse ?? false,
  };
}
