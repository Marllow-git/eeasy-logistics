import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { MessagingRepository, MessagingStore } from '../../platform/messaging.repository.js';
import type { ProviderState } from '../../schema/outbox.js';
import { providerStates } from '../../schema/outbox.js';
import { getMetrics } from '../../telemetry/metrics.js';
import { platformEngineAccountId } from '../message-sender.js';
import type { OptOutList } from '../opt-out-list.js';
import { phoneTail } from '../phone.js';
import {
  bodyHashPattern,
  bodySha256,
  canonicalString,
  engineServiceIdentity,
  isFresh,
  maxEngineBodyBytes,
  noncePattern,
  parseWireInstant,
  signCanonical,
  signatureMatches,
} from './envelope.js';

// The engine's callback door (PLAT-9 plan 2A.2; ADR-0041; engine contract §2.3, §5): verifies the
// envelope in the contract's fixed order, and only an authenticated request has its body read:
//   1 declared length ≤ 256 KiB (413), 2 service identity, 3 key id, 4 timestamp ±60 s, 5 nonce and
//   body-hash shape, 6 HMAC in constant time (each 401), 7 the body read (bounded) and its hash
//   checked (401), 8 the nonce reserved in `core_engine_callback_nonces` (401 on a replay),
//   9 only then the JSON parsed and validated (422), bound to our own account mapping (422), and
//   applied once per `callback_id`. Answers `200 {"ok":true}`; an unknown kind is 400 so the engine
//   dead-letters it. Nothing a callback carries chooses an account: the instance and the message
//   row do, through our tables, and the callback's `eeasy_account_id` must match them.

export interface CallbackDoorSettings {
  /** The key id the engine signs under, and its secret; unset means every callback is refused. */
  readonly keyId: string | undefined;
  readonly secret: string | undefined;
  /** The platform's sender instance (engine account id 1). */
  readonly platformInstanceId: string | undefined;
}

export interface CallbackRequest {
  readonly method: string;
  /** The request path without the query, as signed (contract §2.2). */
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Readable;
}

export interface CallbackAnswer {
  readonly status: number;
  readonly body: { readonly ok: boolean; readonly error?: { readonly code: string } };
}

const ok: CallbackAnswer = { status: 200, body: { ok: true } };
const refuse = (status: number, code: string): CallbackAnswer => ({
  status,
  body: { ok: false, error: { code } },
});

/** A callback's `occurred_at` may lead our clock by at most 300 s (eeasynew's receiver bound). */
const maxFutureMs = 300_000;

const instant = z.string().refine((value) => parseWireInstant(value) !== undefined);
const common = {
  eeasy_account_id: z.number().int().positive(),
  sender_instance_id: z.uuid(),
  occurred_at: instant,
  callback_id: z.uuid(),
};
const messageStatus = z.object({
  callback: z.literal('message.status'),
  ...common,
  eeasy_message_id: z.uuid(),
  status: z.enum(providerStates),
  error: z
    .object({ class: z.string().max(64).optional(), code: z.string().max(64).optional() })
    .nullable()
    .optional(),
});
const suppressionChanged = z.object({
  callback: z.literal('suppression.changed'),
  ...common,
  customer_number: z.string().regex(/^\+[1-9][0-9]{6,17}$/),
  suppressed: z.boolean(),
});
const connectionEvents = [
  'connected',
  'disconnected',
  'qr',
  'reconnecting',
  'needs_relink',
  'banned',
  'replaced',
  'stopped',
] as const;
const connectionEvent = z.object({
  callback: z.literal('connection.event'),
  ...common,
  event: z.enum(connectionEvents),
  corroborated: z.boolean().nullable().optional(),
});
const inboundMessage = z.object({ callback: z.literal('inbound.message'), ...common });
const callbackKinds = [
  'message.status',
  'suppression.changed',
  'connection.event',
  'inbound.message',
];

/**
 * Rank of a message state (engine contract §5.2): a callback applies only when it moves the row
 * forward, so receipts never go back (`read` → `delivered`) and a terminal state is never replaced
 * by another one. In-flight states of one rank replace each other in `occurred_at` order.
 */
export const stateRank: Readonly<Record<ProviderState, number>> = {
  accepted: 0,
  queued: 1,
  held_connection: 1,
  paused_by_admin: 1,
  sending: 2,
  sent: 3,
  failed: 3,
  expired: 3,
  suppressed: 3,
  delivered: 4,
  read: 5,
};

/** Whether `next` (at `at`) replaces the stored state (at `storedAt`). */
export function advances(
  stored: ProviderState | null,
  storedAt: Date | null,
  next: ProviderState,
  at: Date,
): boolean {
  if (stored === null) return true;
  const from = stateRank[stored];
  const to = stateRank[next];
  if (to !== from) {
    // Nothing moves out of a terminal failure; receipts only climb.
    if (stored === 'failed' || stored === 'expired' || stored === 'suppressed') return false;
    return to > from;
  }
  return from < 3 && (storedAt === null || at > storedAt);
}

type Owner = { readonly accountId: string | null; readonly engineAccountId: number } | 'unknown';
type Found = Owner | { readonly unallocated: true };

export interface CallbackDoorDependencies {
  readonly settings: CallbackDoorSettings;
  readonly store: MessagingStore;
  readonly optOuts: Pick<OptOutList, 'add' | 'remove'>;
  readonly now?: () => number;
  readonly logger?: Pick<Logger, 'log' | 'warn'> & Partial<Pick<Logger, 'debug'>>;
}

export class EngineCallbackDoor {
  readonly #deps: CallbackDoorDependencies;
  readonly #now: () => number;
  readonly #logger: Pick<Logger, 'log' | 'warn'> & Partial<Pick<Logger, 'debug'>>;
  /** When each refusal code was last logged at warn. */
  readonly #lastWarned = new Map<string, number>();
  /** Instances whose account has no engine id yet, logged once each. */
  readonly #unallocated = new Set<string>();

  constructor(deps: CallbackDoorDependencies) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#logger = deps.logger ?? new Logger('EngineCallbacks');
  }

  async receive(request: CallbackRequest): Promise<CallbackAnswer> {
    const answer = await this.#receive(request);
    const outcome = answer.status === 200 ? 'ok' : (answer.body.error?.code ?? 'refused');
    getMetrics().add('inbound_webhooks_total', 1, {
      provider: 'whatsapp_engine',
      status: answer.status === 200 ? 'accepted' : 'rejected',
    });
    if (answer.status !== 200) this.#logRefusal(answer.status, outcome);
    return answer;
  }

  /**
   * The first refusal of a code in a minute at warn, the rest at debug (adversary L-1): a flood of
   * forged callbacks cannot flood the log; `inbound_webhooks_total` still counts every one.
   */
  #logRefusal(status: number, code: string): void {
    const now = this.#now();
    const line = `engine callback refused status=${status} code=${code}`;
    if (now - (this.#lastWarned.get(code) ?? -Infinity) >= 60_000) {
      this.#lastWarned.set(code, now);
      this.#logger.warn(line);
    } else {
      this.#logger.debug?.(line);
    }
  }

  async #receive(request: CallbackRequest): Promise<CallbackAnswer> {
    const header = (name: string): string => {
      const value = request.headers[name];
      return typeof value === 'string' ? value : '';
    };
    // 1. The declared length, before anything is read (and the read below is bounded by it).
    const declared = Number(header('content-length'));
    if (header('content-length') === '' || !Number.isInteger(declared) || declared < 0) {
      return refuse(413, 'REQUEST_TOO_LARGE');
    }
    if (declared > maxEngineBodyBytes) return refuse(413, 'REQUEST_TOO_LARGE');
    // 2. The expected peer of this door.
    const service = header('x-eeasy-service');
    if (service !== engineServiceIdentity) return refuse(401, 'AUTH_UNKNOWN_SERVICE');
    // 3. The key id resolves to the configured callback secret.
    const { keyId, secret } = this.#deps.settings;
    const providedKeyId = header('x-eeasy-key-id');
    if (keyId === undefined || secret === undefined || providedKeyId !== keyId) {
      return refuse(401, 'AUTH_UNKNOWN_KEY');
    }
    // 4. Freshness.
    const timestamp = header('x-eeasy-timestamp');
    if (!isFresh(timestamp, this.#now())) return refuse(401, 'AUTH_STALE_TIMESTAMP');
    // 5. Shapes, before either value enters the canonical string or a primary key.
    const nonce = header('x-eeasy-nonce');
    const claimedHash = header('x-eeasy-body-sha256');
    if (!noncePattern.test(nonce) || !bodyHashPattern.test(claimedHash)) {
      return refuse(401, 'AUTH_MALFORMED_HEADER');
    }
    // 6. The HMAC over the canonical string (the claimed hash), in constant time.
    const expected = signCanonical(
      canonicalString({
        method: request.method,
        path: request.path,
        service,
        keyId: providedKeyId,
        timestamp,
        nonce,
        bodySha256: claimedHash,
      }),
      secret,
    );
    if (!signatureMatches(expected, header('x-eeasy-signature'))) {
      return refuse(401, 'AUTH_BAD_SIGNATURE');
    }
    // 7. Only now the body: read up to the declared length, and its hash checked.
    const raw = await readBounded(request.body, declared);
    if (raw === undefined) return refuse(413, 'REQUEST_TOO_LARGE');
    const actual = Buffer.from(bodySha256(raw), 'utf8');
    if (!timingSafeEqual(actual, Buffer.from(claimedHash, 'utf8'))) {
      return refuse(401, 'AUTH_BODY_HASH_MISMATCH');
    }
    // 8. The nonce, single use, reserved before the body is used.
    const fresh = await this.#deps.store.run((repo) => repo.reserveNonce(service, nonce));
    if (!fresh) return refuse(401, 'AUTH_REPLAYED_NONCE');
    // 9. Parse, validate, bind and apply.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return refuse(422, 'SCHEMA_INVALID');
    }
    const kind = (parsed as { callback?: unknown } | null)?.callback;
    if (typeof kind !== 'string' || !callbackKinds.includes(kind)) {
      return refuse(400, 'UNKNOWN_CALLBACK');
    }
    return this.#apply(kind, parsed, service, nonce);
  }

  async #apply(
    kind: string,
    parsed: unknown,
    service: string,
    nonce: string,
  ): Promise<CallbackAnswer> {
    const schema =
      kind === 'message.status'
        ? messageStatus
        : kind === 'suppression.changed'
          ? suppressionChanged
          : kind === 'connection.event'
            ? connectionEvent
            : inboundMessage;
    const result = schema.safeParse(parsed);
    if (!result.success) return refuse(422, 'SCHEMA_INVALID');
    const callback = result.data;
    const occurredAt = parseWireInstant(callback.occurred_at) ?? 0;
    if (occurredAt > this.#now() + maxFutureMs) return refuse(422, 'SCHEMA_INVALID');
    const at = new Date(occurredAt);

    return this.#deps.store.run(async (repo) => {
      const found = await this.#owner(repo, callback.sender_instance_id);
      if (found !== 'unknown' && 'unallocated' in found) {
        // A linked account without an engine id cannot have sent anything (the linking order
        // allocates the id before it creates the instance; adversary L-6). Its connection events
        // are acknowledged and ignored, never refused (a refusal parks the sender); anything else
        // cannot be bound.
        if (callback.callback !== 'connection.event') return refuse(422, 'BINDING_MISMATCH');
        if (!this.#unallocated.has(callback.sender_instance_id)) {
          this.#unallocated.add(callback.sender_instance_id);
          this.#logger.warn('engine connection.event for a sender whose account has no engine id');
        }
        return ok;
      }
      const owner: Owner = found;
      if (owner !== 'unknown' && owner.engineAccountId !== callback.eeasy_account_id) {
        return refuse(422, 'BINDING_MISMATCH');
      }
      // Applied once per callback id; a redelivery is acknowledged and changes nothing.
      if (!(await repo.claimCallback(service, nonce, callback.callback_id))) return ok;
      if (owner === 'unknown') {
        // An instance we never linked (or one since replaced): acknowledged, not applied, and never
        // refused, since a refused connection.event would make the engine park that sender.
        this.#logger.warn(`engine callback for an unknown sender instance kind=${kind}`);
        return ok;
      }
      switch (callback.callback) {
        case 'message.status':
          return this.#messageStatus(repo, owner, callback, at);
        case 'suppression.changed':
          return this.#suppression(owner, callback);
        case 'connection.event':
          return this.#connection(repo, owner, callback, at);
        case 'inbound.message':
          // Wave 0 has no inbound use (ADR-0041): acknowledged and dropped, nothing stored.
          return ok;
      }
    });
  }

  /** Who an instance belongs to, from our tables only (plan 2A.3, 2A.4). */
  async #owner(repo: MessagingRepository, instance: string): Promise<Found> {
    if (instance === this.#deps.settings.platformInstanceId) {
      return { accountId: null, engineAccountId: platformEngineAccountId };
    }
    const owner = await repo.ownerOfInstance(instance);
    if (owner === undefined) return 'unknown';
    if (owner.engineAccountId === null) return { unallocated: true };
    return { accountId: owner.accountId, engineAccountId: owner.engineAccountId };
  }

  async #messageStatus(
    repo: MessagingRepository,
    owner: Exclude<Owner, 'unknown'>,
    callback: z.infer<typeof messageStatus>,
    at: Date,
  ): Promise<CallbackAnswer> {
    const row = await repo.lockMessageRow(callback.eeasy_message_id);
    // An OTP row is deleted an hour after sending; late receipts for it are acknowledged.
    if (row === undefined) return ok;
    if (row.accountId !== owner.accountId) return refuse(422, 'BINDING_MISMATCH');
    if (advances(row.providerState, row.providerUpdatedAt, callback.status, at)) {
      await repo.setProviderState(callback.eeasy_message_id, callback.status, at);
      if (callback.status === 'failed' || callback.status === 'expired') {
        this.#logger.warn(
          `message ${callback.status} at the engine id=${callback.eeasy_message_id} ` +
            `class=${callback.error?.class ?? 'n/a'}`,
        );
      }
    }
    return ok;
  }

  async #suppression(
    owner: Exclude<Owner, 'unknown'>,
    callback: z.infer<typeof suppressionChanged>,
  ): Promise<CallbackAnswer> {
    // The platform number carries OTP, which opt-out never blocks (integrations §5.5).
    if (owner.accountId === null) return ok;
    if (callback.suppressed) {
      await this.#deps.optOuts.add(owner.accountId, callback.customer_number, 'provider');
    } else {
      await this.#deps.optOuts.remove(owner.accountId, callback.customer_number);
    }
    this.#logger.log(
      `opt-out ${callback.suppressed ? 'added' : 'removed'} source=provider ` +
        `to=${phoneTail(callback.customer_number)}`,
    );
    return ok;
  }

  async #connection(
    repo: MessagingRepository,
    owner: Exclude<Owner, 'unknown'>,
    callback: z.infer<typeof connectionEvent>,
    at: Date,
  ): Promise<CallbackAnswer> {
    const sender = owner.accountId === null ? 'platform' : 'account';
    if (owner.accountId !== null) {
      await repo.setSenderStatus(callback.sender_instance_id, callback.event, at);
    }
    if (callback.event === 'needs_relink' || callback.event === 'banned') {
      // ADR-0041: a disconnected or banned sender is an alert (observability/alerts.yaml).
      getMetrics().add('messaging_sender_alerts_total', 1, { event: callback.event, sender });
      this.#logger.warn(
        `whatsapp sender ${callback.event} sender=${sender} corroborated=${String(callback.corroborated ?? null)}`,
      );
    }
    return ok;
  }
}

/** Reads at most `limit` bytes; undefined when the stream carries more (a dishonest length). */
async function readBounded(stream: Readable, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) {
      stream.destroy();
      return undefined;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
