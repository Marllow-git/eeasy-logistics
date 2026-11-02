import { isUuid } from '@eeasy-logistics/db';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';
import type { CrossTenantSource } from '../tenancy/cross-tenant.js';
import { CROSS_TENANT, IS_PUBLIC, principalOf } from '../tenancy/frame.js';
import type { FeatureKey } from './feature-keys.js';
import type { FeatureResolver } from './feature-resolver.js';

// The feature gate (PLAT-13 plan 2.5; ADR-0006; K-6; errors.md `feature_not_enabled`): a module's
// routes carry `@Feature('<key>')`, and the gate, a global guard after the permission guard,
// answers `403 feature_not_enabled` unless K-6 holds for the principal's account. Platform staff
// pass, except on a cross-tenant door that names its account in the path, which is checked the same
// way. No existing route is gated in this order: the DEL and WMS orders add `@Feature` as they ship.

export const FEATURE = Symbol('elx:feature');

/** The K-6 resolver of the gate, provided by `RequestFrameModule`; null without the platform pool. */
export const FEATURE_RESOLVER = Symbol('FEATURE_RESOLVER');

/** Gates a handler or a controller behind a registered feature key. */
export const Feature = (key: FeatureKey): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE, key);

@Injectable()
export class FeatureGate implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(FEATURE_RESOLVER) private readonly resolver?: FeatureResolver | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (key === undefined) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const accountId = this.accountOf(context, request);
    if (accountId === null) return true;
    const resolver = this.resolver;
    if (resolver === undefined || resolver === null) throw new ApiException('internal_error');
    if (!(await resolver.enabled(accountId, key))) throw new ApiException('feature_not_enabled');
    return true;
  }

  /**
   * The account K-6 is checked for: the token's (staff, driver); for platform staff the account a
   * path door names, or null (platform work passes). A gated route with no account to check (a
   * public route, a recipient link: no module route is either in wave 0) is refused.
   */
  private accountOf(context: ExecutionContext, request: Request): string | null {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const principal = isPublic === true ? undefined : principalOf(request);
    if (principal === undefined) throw new ApiException('feature_not_enabled');
    if (principal.kind !== 'platform') return principal.accountId;
    const door = this.reflector.get<CrossTenantSource | undefined>(
      CROSS_TENANT,
      context.getHandler(),
    );
    if (door?.from !== 'path') return null;
    const raw = request.params[door.name];
    // A malformed id is the door's `404` to answer, with its audit row.
    return typeof raw === 'string' && isUuid(raw) ? raw : null;
  }
}
