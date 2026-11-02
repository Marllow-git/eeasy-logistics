import { createHash } from 'node:crypto';
import { findContext, findPlatformContext, getContext, getUnitOfWork } from '@eeasy-logistics/db';
import type { AuditFacts } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { RolloutRow } from '../platform/features.repository.js';
import { currentFeatureRows } from '../platform/features.repository.js';
import type { RolloutModeValue } from '../schema/rollout.js';
import type { FeatureKey } from './feature-keys.js';
import { featureKeys, isFeatureKey } from './feature-keys.js';
import type { FeatureResolver } from './feature-resolver.js';
import type { FeatureFlagRow } from './feature-flags.repository.js';
import { FeatureFlagsRepository } from './feature-flags.repository.js';

// The rollout and flag doors (PLAT-13 plan 2.6; ADR-0006; K-6, K-7): rollout modes are platform
// rows a super admin sets; flags are an account's rows an admin sets inside the account's door.
// Each change is audited with before, after and the reason in its own transaction, emits
// `core.feature_flag.changed` (the `internal_event` whose kernel consumer busts the gate's cache
// after commit) and forgets the cached value in the request.

/** The reason of a rollout change (plan 2.6): 5 to 500 characters, no control characters. */
export function rolloutReasonProblem(
  reason: string,
): 'too_short' | 'too_long' | 'invalid' | undefined {
  const trimmed = reason.trim();
  const length = [...trimmed].length;
  if (length < 5) return 'too_short';
  if (length > 500) return 'too_long';
  return /\p{Cc}/u.test(trimmed) ? 'invalid' : undefined;
}

const aggregateNamespace = Buffer.from('6c0f1d7e5a2b4f0e9c3d8a1b2e4f6a70', 'hex');

/**
 * A stable UUID (RFC 9562 version 5) for an aggregate that has no UUID of its own (a feature key; an
 * account's flag, keyed by account and key), so its events share one ordering scope.
 */
export function nameAggregateId(name: string): string {
  const hash = createHash('sha1').update(aggregateNamespace).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A registered key's rollout: its row, or the default `allowlist` with no author (plan 2.6). */
export interface RolloutView {
  readonly featureKey: FeatureKey;
  readonly mode: RolloutModeValue;
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
}

/** A registered key's flag on an account: its row, or disabled. */
export interface FlagView {
  readonly featureKey: FeatureKey;
  readonly enabled: boolean;
  readonly provisionedBy: string | null;
  readonly enabledAt: Date | null;
}

function rolloutView(key: FeatureKey, row: RolloutRow | undefined): RolloutView {
  return {
    featureKey: key,
    mode: row?.mode ?? 'allowlist',
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

function flagView(key: FeatureKey, row: FeatureFlagRow | undefined): FlagView {
  return {
    featureKey: key,
    enabled: row?.enabled ?? false,
    provisionedBy: row?.provisionedBy ?? null,
    enabledAt: row?.enabledAt ?? null,
  };
}

function caller(): string {
  const userId = findContext()?.userId ?? findPlatformContext()?.userId;
  if (userId === undefined || userId === null)
    throw new Error('A feature door ran outside a request');
  return userId;
}

/** A path key that names no registered feature is `404 not_found`, like an unknown resource. */
function registeredKey(key: string): FeatureKey {
  if (!isFeatureKey(key)) throw new ApiException('not_found');
  return key;
}

export interface FeaturesDependencies {
  readonly audit: AuditSink;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  readonly resolver: Pick<FeatureResolver, 'forgetRollout' | 'forgetFlag'> | null;
}

export class FeaturesService {
  constructor(private readonly deps: FeaturesDependencies) {}

  /** `platformListRolloutModes`: every registered key, in registry order. */
  async rolloutModes(): Promise<RolloutView[]> {
    const rows = new Map((await currentFeatureRows().rows.modes()).map((r) => [r.featureKey, r]));
    return featureKeys.map((key) => rolloutView(key, rows.get(key)));
  }

  /**
   * `platformSetRolloutMode` (plan 2.6): the reason checked, the key's row locked, then (when the
   * mode changes) the upsert, `core.rollout_mode.changed` with before, after and reason, and the
   * platform-only `core.feature_flag.changed` event, all in the request's platform transaction.
   */
  async setRolloutMode(
    rawKey: string,
    mode: RolloutModeValue,
    reason: string,
    facts: AuditFacts,
  ): Promise<RolloutView> {
    const key = registeredKey(rawKey);
    const problem = rolloutReasonProblem(reason);
    if (problem !== undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/reason', code: problem }],
      });
    }
    const userId = caller();
    const { uow, rows } = currentFeatureRows();
    const before = await rows.mode(key, { lock: true });
    const previous = before?.mode ?? 'allowlist';
    if (before !== undefined && previous === mode) return rolloutView(key, before);
    const written = await rows.setMode(key, mode, userId);
    await this.deps.audit.recordIn(uow, {
      actorType: 'platform_user',
      actorId: userId,
      accountId: null,
      targetType: 'rollout_mode',
      targetId: key,
      action: 'core.rollout_mode.changed',
      before: { mode: previous },
      after: { mode },
      reason: reason.trim(),
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    await this.deps.outbox.enqueue(uow, {
      type: 'core.feature_flag.changed',
      version: 1,
      // The rollout row carries no version (2.1): sequence 1, ties ordered by the row id (UUIDv7).
      aggregate: { type: 'rollout_mode', id: nameAggregateId(`rollout:${key}`), version: 1 },
      payload: { feature_key: key, mode },
      kind: 'internal_event',
    });
    await this.deps.resolver?.forgetRollout(key);
    return rolloutView(key, written);
  }

  /** `platformListFeatureFlags`, inside the account's door: every registered key. */
  async flags(): Promise<FlagView[]> {
    const rows = new Map(
      (await new FeatureFlagsRepository(getUnitOfWork()).all()).map((r) => [r.featureKey, r]),
    );
    return featureKeys.map((key) => flagView(key, rows.get(key)));
  }

  /**
   * `platformSetFeatureFlag` (plan 2.6), inside the account's door (its reason is the body's): under
   * the account's flag lock, enable (`provisioned_by` the caller, `enabled_at` now) or disable
   * (both cleared), `version + 1`; audited `core.feature_flag.changed` with before, after and the
   * reason, and the `core.feature_flag.changed` event of the account, in the door's transaction. A
   * call that changes nothing writes nothing but the door's row.
   */
  async setFlag(
    rawKey: string,
    enabled: boolean,
    reason: string,
    facts: AuditFacts,
  ): Promise<FlagView> {
    const key = registeredKey(rawKey);
    const userId = caller();
    const uow = getUnitOfWork();
    const accountId = getContext().accountId;
    const flags = new FeatureFlagsRepository(uow);
    await flags.lockForWrite();
    const existing = await flags.find(key);
    if ((existing?.enabled ?? false) === enabled) return flagView(key, existing);
    const written = await flags.set(key, enabled, userId, existing);
    await this.deps.audit.record({
      actorType: 'platform_user',
      actorId: userId,
      accountId,
      targetType: 'feature_flag',
      targetId: key,
      action: 'core.feature_flag.changed',
      before: { enabled: existing?.enabled ?? false },
      after: { enabled },
      reason: reason.trim(),
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    await this.deps.outbox.enqueue(uow, {
      type: 'core.feature_flag.changed',
      version: 1,
      aggregate: {
        type: 'feature_flag',
        id: nameAggregateId(`flag:${accountId}:${key}`),
        version: written.version,
      },
      payload: { account_id: accountId, feature_key: key, enabled },
      kind: 'internal_event',
    });
    await this.deps.resolver?.forgetFlag(accountId, key);
    return flagView(key, written);
  }
}
