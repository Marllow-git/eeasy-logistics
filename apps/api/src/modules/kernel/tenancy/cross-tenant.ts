import { isUuid } from '@eeasy-logistics/db';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';
import { CROSS_TENANT } from './frame.js';

// The cross-tenant door (PLAT-6 plan 2.7; identity and tenancy §5; contracts README §1): the only
// way platform staff reach an account's rows. The route names the target as `:account_id`, the
// contract's path parameter (the one
// place an account id comes from a path, by contract: `x-cross-tenant: true`), the caller states
// why in `X-Support-Reason`, and every call emits an audit event.

export const accountIdParam = 'account_id';
export const supportReasonHeader = 'x-support-reason';
export const supportReasonMaxLength = 200;

/**
 * Marks a platform handler that reads or writes one account's rows. Its route must declare
 * `:account_id` (the contract's name, so the ContractPipe parses it too); the unit of work then runs on the platform pool with `elx.account_id` set to it,
 * so tenant repositories built from `getUnitOfWork()` see that account only.
 */
export const CrossTenant = (): MethodDecorator => SetMetadata(CROSS_TENANT, true);

export interface CrossTenantTarget {
  readonly accountId: string;
  readonly reason: string;
}

/** A refused door call: what the audit event records, and the error the caller answers. */
export interface CrossTenantRefusal {
  readonly outcome: 'reason_missing' | 'reason_invalid' | 'not_found';
  /** The target when it is a well-formed id; a malformed path value is never recorded. */
  readonly accountId: string | null;
  readonly error: ApiException;
}

/**
 * The target and reason of a `@CrossTenant()` request, or why it is refused. A missing or blank
 * reason is `400 reason_required` (errors.md §5); a reason over 200 characters or with control
 * characters is `400 validation_failed`; a malformed account id is `404 not_found`, like an
 * unknown one. The caller audits refusals too (identity and tenancy §5: every call).
 */
export function crossTenantTarget(request: Request): CrossTenantTarget | CrossTenantRefusal {
  const raw: unknown = request.params[accountIdParam];
  if (typeof raw !== 'string') {
    // A programming error: the decorator is on a route without `:account_id`.
    throw new Error('@CrossTenant() needs a route parameter :account_id');
  }
  const accountId = isUuid(raw) ? raw : null;
  const header = request.headers[supportReasonHeader];
  const reason = typeof header === 'string' ? header.trim() : '';
  if (reason === '') {
    return { outcome: 'reason_missing', accountId, error: new ApiException('reason_required') };
  }
  const pointer = `/header/${supportReasonHeader}`;
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
