import type { PlatformContext, RequestContext } from '@eeasy-logistics/db';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from '../auth/principal.js';

// The request frame (PLAT-6 plan 2.4 to 2.7): metadata keys, the principal of a request and the
// port to the platform pool. The guard resolves the principal once; the unit-of-work interceptor
// turns it into the `RequestContext` of packages/db; handlers read `getContext()` only.

export const IS_PUBLIC = Symbol('elx:public');
export const CROSS_TENANT = Symbol('elx:cross-tenant');

/** The principal resolver (`PrincipalResolver`), provided by `RequestFrameModule.forRoot`. */
export const PRINCIPAL_RESOLVER = Symbol('PRINCIPAL_RESOLVER');

/**
 * A handler (or controller) without authentication: health probes and, later, the sign-in doors
 * (`core.auth.anonymous`). It gets no principal, no context and no unit of work.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

const principals = new WeakMap<Request, Principal>();

/** Records the principal the guard resolved; once per request. */
export function setPrincipal(request: Request, principal: Principal): void {
  if (principals.has(request)) throw new Error('The principal of a request is set once');
  principals.set(request, principal);
}

/** The principal of an authenticated request, or undefined on a public one. */
export function principalOf(request: Request): Principal | undefined {
  return principals.get(request);
}

/**
 * The platform pool behind a port (the pool itself is constructed only in
 * `modules/kernel/platform/`, ADR-0031 and the architecture test). Provided by `PlatformModule`.
 */
export interface PlatformFrames {
  /** A platform request: one transaction on elx_platform with no account (plan 2.6). */
  runPlatform<T>(context: PlatformContext, fn: () => Promise<T>): Promise<T>;
  /** A `@CrossTenant()` request: elx_platform with `elx.account_id` = the target (plan 2.7). */
  runCrossTenant<T>(context: RequestContext, fn: () => Promise<T>): Promise<T>;
}

export const PLATFORM_FRAMES = Symbol('PLATFORM_FRAMES');
