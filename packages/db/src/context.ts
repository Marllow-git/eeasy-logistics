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
  /** The request id (PLAT-6 plan 2.1), for audit events and log lines; absent in jobs. */
  readonly requestId?: string;
  /**
   * The sites a site-scoped principal is restricted to for this request (PLAT-10 plan 2.6;
   * lowercase UUIDs, possibly none); absent when the request is not site-scoped. Repositories add
   * the kernel's `siteFilter` over it.
   */
  readonly siteIds?: readonly string[];
}

/** Platform staff on the platform surface: no account (identity and tenancy §5; PLAT-6 2.5). */
export interface PlatformContext {
  readonly userId: string;
  readonly requestId?: string;
}

/**
 * What the current request or job runs with: one context (tenant or platform) and, inside a unit
 * of work, that unit of work. One store, so the context and the transaction can never disagree.
 */
export interface Frame {
  readonly context?: RequestContext;
  readonly platform?: PlatformContext;
  readonly unitOfWork?: object;
}

const storage = new AsyncLocalStorage<Frame>();

/** The tenant context of the current request or job; throws outside one (and for platform). */
export function getContext(): RequestContext {
  const context = storage.getStore()?.context;
  if (context === undefined) {
    throw new Error('No request context: database work runs inside a unit of work');
  }
  return context;
}

/** The tenant context, or undefined outside a tenant request or job. */
export function findContext(): RequestContext | undefined {
  return storage.getStore()?.context;
}

/** The platform context of the current platform request, or undefined. */
export function findPlatformContext(): PlatformContext | undefined {
  return storage.getStore()?.platform;
}

/** The current frame (package-internal: unit-of-work.ts and platform.ts read it). */
export function currentFrame(): Frame | undefined {
  return storage.getStore();
}

/** Runs `fn` in `frame` (package-internal). */
export function runInFrame<T>(frame: Frame, fn: () => T): T {
  return storage.run(Object.freeze({ ...frame }), fn);
}

/**
 * Runs `fn` with `context` as the current context, without a transaction. Not exported from the
 * package root: requests and jobs get their context from `withUnitOfWork`; tests use
 * `@eeasy-logistics/db/testing`.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return runInFrame({ context: checkContext(context) }, fn);
}

/**
 * Validates and freezes a context, so a unit of work never sets a malformed account id; its
 * `siteIds`, when present, must be lowercase UUIDs and are carried as a frozen copy.
 */
export function checkContext(context: RequestContext): RequestContext {
  if (!isUuid(context.accountId)) {
    throw new Error('The request context has no valid account id');
  }
  const { siteIds } = context;
  if (siteIds !== undefined && !siteIds.every((site) => isUuid(site))) {
    throw new Error('The request context has a site id that is not a lowercase UUID');
  }
  if (Object.isFrozen(context) && (siteIds === undefined || Object.isFrozen(siteIds))) {
    return context;
  }
  return Object.freeze({
    ...context,
    ...(siteIds === undefined ? {} : { siteIds: Object.freeze([...siteIds]) }),
  });
}

/** Validates and freezes a platform context. */
export function checkPlatformContext(context: PlatformContext): PlatformContext {
  if (!isUuid(context.userId)) {
    throw new Error('The platform context has no valid user id');
  }
  return Object.isFrozen(context) ? context : Object.freeze({ ...context });
}
