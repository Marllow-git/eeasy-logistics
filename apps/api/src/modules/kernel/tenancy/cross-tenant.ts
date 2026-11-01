import { isUuid } from '@eeasy-logistics/db';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';
import { CROSS_TENANT } from './frame.js';

// The cross-tenant door (PLAT-6 plan 2.7; identity and tenancy §5; contracts README §1): the only
// way platform staff reach an account's rows. The route names the target as `:account_id`, the
// contract's path parameter (the one place an account id comes from a request, by contract:
// `x-cross-tenant: true`; PLAT-7 adds the declared query form of `platformListAudit`, PLAT-8 the
// body form and the resource lookup of the outbox operations), the caller states why in
// `X-Support-Reason` (or the body's `reason`), and every call leaves one audit row.

export const accountIdParam = 'account_id';
export const supportReasonHeader = 'x-support-reason';
export const supportReasonMaxLength = 200;

/**
 * Resolves the account of the resource a `lookup` door names (PLAT-8 plan 2.7: an outbox row's
 * account). Runs in a platform unit of work before the door opens; answers undefined when the
 * resource does not exist, `{ accountId: null }` for a resource of no account (platform-only).
 */
export type CrossTenantLookup = (
  id: string,
) => Promise<{ readonly accountId: string | null } | undefined>;

/**
 * Where a `@CrossTenant()` handler names its target account. `path` (the default) is the
 * contract's `:account_id` route parameter. The declared exceptions: `query` (PLAT-7 plan 2.7,
 * `platformListAudit`) and `body` (PLAT-8 `platformReplayDeadOutbox`), a parameter that, when
 * absent, makes the call plain platform work with no door and no account; `lookup` (PLAT-8
 * `platformGetOutboxRow`, `platformReplayOutboxRow`), a route parameter naming a resource whose
 * account `lookup` resolves (a resource of no account is plain platform work). `reason` says where
 * the support reason is: the `X-Support-Reason` header (default) or the body's `reason` (an
 * operation whose contract carries the reason in its body).
 */
export type CrossTenantSource =
  | {
      readonly from: 'path' | 'query' | 'body';
      readonly name: string;
      readonly reason?: 'header' | 'body';
    }
  | {
      readonly from: 'lookup';
      readonly name: string;
      readonly reason?: 'header' | 'body';
      /** The audit target type of a refused lookup (`outbox_row`). */
      readonly resource: string;
      readonly lookup: CrossTenantLookup;
    };

/**
 * Marks a platform handler that reads or writes one account's rows. By default its route must
 * declare `:account_id` (the contract's name, so the ContractPipe parses it too); the unit of work
 * then runs on the platform pool with `elx.account_id` set to it, so tenant repositories built
 * from `getUnitOfWork()` see that account only.
 */
export const CrossTenant = (
  source: CrossTenantSource = { from: 'path', name: accountIdParam },
): MethodDecorator => SetMetadata(CROSS_TENANT, Object.freeze({ ...source }));

export interface CrossTenantTarget {
  /** The target account; for a `lookup` source, the resource id until the lookup resolves it. */
  readonly accountId: string;
  readonly reason: string;
}

/** A refused door call: what the audit row records, and the error the caller answers. */
export interface CrossTenantRefusal {
  readonly outcome: 'reason_missing' | 'reason_invalid' | 'not_found';
  /** The target (an account, or a `lookup` resource) when it is a well-formed id; never raw. */
  readonly accountId: string | null;
  readonly error: ApiException;
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function rawTarget(request: Request, source: CrossTenantSource): unknown {
  if (source.from === 'path' || source.from === 'lookup') {
    const raw = request.params[source.name];
    if (typeof raw !== 'string') {
      // A programming error: the decorator is on a route without the parameter.
      throw new Error(`@CrossTenant() needs a route parameter :${source.name}`);
    }
    return raw;
  }
  const bag = objectOf(source.from === 'query' ? request.query : request.body);
  return bag !== undefined && Object.hasOwn(bag, source.name) ? bag[source.name] : undefined;
}

function rawReason(request: Request, source: CrossTenantSource): unknown {
  if (source.reason === 'body') return objectOf(request.body)?.reason;
  return request.headers[supportReasonHeader];
}

/**
 * The target and reason of a `@CrossTenant()` request, or why it is refused, or undefined when a
 * query- or body-declared parameter is absent (no door). A missing or blank reason is
 * `400 reason_required` (errors.md §5); a reason over 200 characters or with control characters is
 * `400 validation_failed`; a malformed id (a repeated query value included) is `404 not_found`,
 * like an unknown one. The caller audits refusals too (identity and tenancy §5).
 */
export function crossTenantTarget(
  request: Request,
  source: CrossTenantSource,
): CrossTenantTarget | CrossTenantRefusal | undefined {
  const raw = rawTarget(request, source);
  if (raw === undefined) return undefined;
  const accountId = typeof raw === 'string' && isUuid(raw) ? raw : null;
  const given = rawReason(request, source);
  const reason = typeof given === 'string' ? given.trim() : '';
  if (reason === '') {
    return { outcome: 'reason_missing', accountId, error: new ApiException('reason_required') };
  }
  const pointer = source.reason === 'body' ? '/body/reason' : `/header/${supportReasonHeader}`;
  const hasControl = /\p{Cc}/u.test(reason);
  if (hasControl || [...reason].length > supportReasonMaxLength) {
    const code = hasControl ? 'invalid' : 'too_long';
    return {
      outcome: 'reason_invalid',
      accountId,
      error: new ApiException('validation_failed', { fields: [{ pointer, code }] }),
    };
  }
  if (accountId === null) {
    return { outcome: 'not_found', accountId, error: new ApiException('not_found') };
  }
  return { accountId, reason };
}

export function isRefusal(
  value: CrossTenantTarget | CrossTenantRefusal,
): value is CrossTenantRefusal {
  return 'outcome' in value;
}
