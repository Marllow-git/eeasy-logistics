import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Principal, PrincipalResolver } from '../auth/principal.js';
import { surfaceOf } from '../auth/surfaces.js';
import { ApiException } from '../errors/api-exception.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { RATE_LIMITER, rateLimitIdentity } from '../rate-limit/rate-limiter.js';
import { IS_PUBLIC, PRINCIPAL_RESOLVER, setPrincipal } from './frame.js';

/**
 * The global tenancy guard (PLAT-6 plan 2.5; identity and tenancy §5; ADR-0025). Every handler is
 * authenticated unless marked `@Public()`: the surface comes from the path prefix, the principal
 * from that surface's credential, and nothing else in the path, query or body is read (K-3). A
 * handler outside every surface that is not public is refused, so a new route fails closed.
 *
 * It also charges the request to its rate-limit budget (plan 2.10) once the identity is known: the
 * user or device of the principal, else the client address for a public route or a refused
 * credential, so failed sign-ins and forged tokens spend an address budget and answer 429 once it
 * is gone. Every limited response carries the `RateLimit-*` headers, refusals included.
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(PRINCIPAL_RESOLVER) private readonly resolver?: PrincipalResolver,
    @Optional() @Inject(RATE_LIMITER) private readonly limiter?: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (isPublic === true) {
      await this.charge(request, response, undefined);
      return true;
    }
    let principal: Principal;
    try {
      const surface = surfaceOf(request.path);
      if (surface === undefined || this.resolver === undefined) {
        throw new ApiException('unauthenticated');
      }
      principal = await this.resolver.resolve(surface, request.headers);
    } catch (refusal) {
      await this.charge(request, response, undefined);
      throw refusal;
    }
    setPrincipal(request, principal);
    await this.charge(request, response, principal);
    return true;
  }

  private async charge(
    request: Request,
    response: Response,
    principal: Principal | undefined,
  ): Promise<void> {
    await this.limiter?.enforce(request, response, rateLimitIdentity(principal, request));
  }
}
