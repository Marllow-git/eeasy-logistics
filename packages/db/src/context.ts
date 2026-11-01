import { AsyncLocalStorage } from 'node:async_hooks';
import { isUuid } from './uuid.ts';

/**
 * Who a unit of work acts for (identity and tenancy §5). Resolved once from the token by the
 * request guard (PLAT-6) or from a job payload; never from a request parameter (ADR-0025, K-3).
 */
export interface RequestContext {
  /** The tenant; every scoped read and write is limited to it. */
  readonly accountId: string;
  readonly membershipId: string | null;
  readonly userId: string | null;
  readonly deviceId: string | null;
  /** True only for platform staff acting on an account through a `@CrossTenant()` handler. */
  readonly actingCrossTenant: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context of the current request or job; throws when code runs outside one. */
export function getContext(): RequestContext {
  const context = storage.getStore();
  if (context === undefined) {
    throw new Error('No request context: database work runs inside a unit of work');
  }
  return context;
}

/** The context, or undefined outside a request or job. */
export function findContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with `context` as the current context. Not exported from the package root: the request
 * guard (PLAT-6) and the job runner get their own entry; tests use `@eeasy-logistics/db/testing`.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(checkContext(context), fn);
}

/** Validates and freezes a context, so a unit of work never sets a malformed account id. */
export function checkContext(context: RequestContext): RequestContext {
  if (!isUuid(context.accountId)) {
    throw new Error('The request context has no valid account id');
  }
  return Object.isFrozen(context) ? context : Object.freeze({ ...context });
}
