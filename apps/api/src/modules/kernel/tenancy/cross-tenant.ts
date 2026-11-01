import { isUuid } from '@eeasy-logistics/db';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';
import { CROSS_TENANT } from './frame.js';

// The cross-tenant door (PLAT-6 plan 2.7; identity and tenancy §5; contracts README §1): the only
// way platform staff reach an account's rows. The route names the target as `:accountId` (the one
// place an account id comes from a path, by contract: `x-cross-tenant: true`), the caller states
// why in `X-Support-Reason`, and every call emits an audit event.

export const accountIdParam = 'accountId';
export const supportReasonHeader = 'x-support-reason';
export const supportReasonMaxLength = 200;

/**
 * Marks a platform handler that reads or writes one account's rows. Its route must declare
 * `:accountId`; the unit of work then runs on the platform pool with `elx.account_id` set to it,
 * so tenant repositories built from `getUnitOfWork()` see that account only.
 */
export const CrossTenant = (): MethodDecorator => SetMetadata(CROSS_TENANT, true);

export interface CrossTenantTarget {
  readonly accountId: string;
  readonly reason: string;
}

/**
 * The target and reason of a `@CrossTenant()` request. A missing or blank reason is
 * `400 reason_required` (errors.md §5); a reason over 200 characters or with control characters is
 * `400 validation_failed`; a malformed account id is `404 not_found`, like an unknown one.
 */
export function crossTenantTarget(request: Request): CrossTenantTarget {
  const accountId: unknown = request.params[accountIdParam];
  if (typeof accountId !== 'string') {
    // A programming error: the decorator is on a route without `:accountId`.
    throw new Error('@CrossTenant() needs a route parameter :accountId');
  }
  const header = request.headers[supportReasonHeader];
  const reason = typeof header === 'string' ? header.trim() : '';
  if (reason === '') throw new ApiException('reason_required');
  const pointer = `/header/${supportReasonHeader}`;
  if ([...reason].length > supportReasonMaxLength) {
    throw new ApiException('validation_failed', { fields: [{ pointer, code: 'too_long' }] });
  }
  if (/\p{Cc}/u.test(reason)) {
    throw new ApiException('validation_failed', { fields: [{ pointer, code: 'invalid' }] });
  }
  if (!isUuid(accountId)) throw new ApiException('not_found');
  return { accountId, reason };
}
