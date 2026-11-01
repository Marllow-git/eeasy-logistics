import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PrincipalResolver } from '../auth/principal.js';
import { surfaceOf } from '../auth/surfaces.js';
import { ApiException } from '../errors/api-exception.js';
import { IS_PUBLIC, PRINCIPAL_RESOLVER, setPrincipal } from './frame.js';

/**
 * The global tenancy guard (PLAT-6 plan 2.5; identity and tenancy §5; ADR-0025). Every handler is
 * authenticated unless marked `@Public()`: the surface comes from the path prefix, the principal
 * from that surface's credential, and nothing else in the path, query or body is read (K-3). A
 * handler outside every surface that is not public is refused, so a new route fails closed.
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(PRINCIPAL_RESOLVER) private readonly resolver?: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const surface = surfaceOf(request.path);
    if (surface === undefined || this.resolver === undefined) {
      throw new ApiException('unauthenticated');
    }
    setPrincipal(request, await this.resolver.resolve(surface, request.headers));
    return true;
  }
}
