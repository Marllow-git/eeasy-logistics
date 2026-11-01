import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { surfaceOf } from '../auth/surfaces.js';
import { ApiException } from '../errors/api-exception.js';

// The web client marker (PLAT-6 plan 2.11; ADR-0032 Decision bullets 1 and 4; ADR-0038 Decision
// bullets 3 and 6; contracts README §3 "Web client marker"). The staff and platform surfaces are
// called same-origin by the browser with a host-only cookie; on top of SameSite=Lax, every write
// there must carry `X-EL-Client: web` and the `Origin` of its own application: the merchant web
// (`PUBLIC_WEB_URL`) for staff, the platform console (`PUBLIC_ADMIN_URL`) for platform. Anything
// else is `403 forbidden`. A guard, so it runs before every interceptor: a refused write never
// opens a transaction or reserves an idempotency key.

export const clientMarkerHeader = 'x-el-client';

/** The origins the marker accepts per surface; provided by `RequestFrameModule.forRoot`. */
export interface WebOrigins {
  readonly staff: string | undefined;
  readonly platform: string | undefined;
}

export const WEB_ORIGINS = Symbol('WEB_ORIGINS');

/** The origin (scheme, host, port) of a configured public URL, or undefined. */
export function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * True when `request` passes the marker rule. Reads and every other surface pass; a staff or
 * platform write passes only with the marker and its application's exact origin. Without a
 * configured origin (allowed outside production only) every such write is refused: fail closed.
 */
export function passesWebClientMarker(
  request: Pick<Request, 'method' | 'path' | 'headers'>,
  origins: WebOrigins | undefined,
): boolean {
  if (safeMethods.has(request.method)) return true;
  const surface = surfaceOf(request.path);
  if (surface !== 'staff' && surface !== 'platform') return true;
  if (request.headers[clientMarkerHeader] !== 'web') return false;
  const expected = origins?.[surface];
  const origin = request.headers.origin;
  return expected !== undefined && typeof origin === 'string' && origin === expected;
}

@Injectable()
export class WebClientGuard implements CanActivate {
  constructor(@Optional() @Inject(WEB_ORIGINS) private readonly origins?: WebOrigins) {}

  canActivate(context: ExecutionContext): boolean {
    if (!passesWebClientMarker(context.switchToHttp().getRequest<Request>(), this.origins)) {
      throw new ApiException('forbidden');
    }
    return true;
  }
}
