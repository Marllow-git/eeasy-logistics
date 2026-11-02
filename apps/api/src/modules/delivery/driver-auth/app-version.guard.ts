import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { DevicePlatform } from '../../kernel/public/index.js';
import { ApiException, devicePlatforms, requestSurface } from '../../kernel/public/index.js';
import { DRIVER_MIN_APP_VERSION } from '../delivery.tokens.js';

// The minimum driver app version (DEL-4 plan 2.10; driver app §13.5; Q-24 provisional; contracts
// `XAppVersion`): a compatibility hint, not a security control. A driver call that names its
// platform and a `major.minor.patch` version below that platform's configured minimum answers
// `426 app_update_required` with `details.min_app_version`; a missing or unreadable header passes
// (the first builds predate the signal; the contract pipe answers a malformed one), and so does
// every route marked `@ReplayRoute()` (the outbox-replay routes DEL-5 and DEL-6 add), so a queued
// outbox drains before the update.

/** The lowest app version per platform (`DRIVER_MIN_APP_VERSION_<PLATFORM>`; absent: none). */
export type MinAppVersions = Readonly<Partial<Record<DevicePlatform, string>>>;

export const REPLAY_ROUTE = Symbol('elx:replay-route');

/** Marks a driver route that replays the app's outbox: the version guard lets it through. */
export const ReplayRoute = (): MethodDecorator & ClassDecorator => SetMetadata(REPLAY_ROUTE, true);

const versionPattern = /^([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})$/;

/** `major.minor.patch` as three integers, or undefined for anything else. */
export function parseAppVersion(value: string): readonly [number, number, number] | undefined {
  const match = versionPattern.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer (numeric parts). */
export function compareAppVersions(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The minimum `version` on `platform` falls short of, or undefined when it does not. */
export function versionShortfall(
  minimums: MinAppVersions,
  platform: string | undefined,
  version: string | undefined,
): string | undefined {
  if (platform === undefined || version === undefined) return undefined;
  if (!(devicePlatforms as readonly string[]).includes(platform)) return undefined;
  const minimum = minimums[platform as DevicePlatform];
  if (minimum === undefined) return undefined;
  const presented = parseAppVersion(version);
  const lowest = parseAppVersion(minimum);
  if (presented === undefined || lowest === undefined) return undefined;
  return compareAppVersions(presented, lowest) < 0 ? minimum : undefined;
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIVER_MIN_APP_VERSION) private readonly minimums: MinAppVersions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // The surface the router matched (adversary L-1): `/V1/DRIVER/me` reaches the driver handler.
    if (requestSurface(request) !== 'driver') return true;
    const replay = this.reflector.getAllAndOverride<boolean | undefined>(REPLAY_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (replay === true) return true;
    const minimum = versionShortfall(
      this.minimums,
      header(request, 'x-app-platform'),
      header(request, 'x-app-version'),
    );
    if (minimum !== undefined) {
      throw new ApiException('app_update_required', { details: { min_app_version: minimum } });
    }
    return true;
  }
}
