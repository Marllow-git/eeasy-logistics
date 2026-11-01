import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { from, lastValueFrom } from 'rxjs';
import { APP_POOL } from '../../../database/database.module.js';
import type { Principal } from '../auth/principal.js';
import { ApiException } from '../errors/api-exception.js';
import { requestIdOf } from '../request/request-id.js';
import type { PlatformFrames } from './frame.js';
import { PLATFORM_FRAMES, principalOf } from './frame.js';

/** Carries a handler's value out of a transaction that must roll back (a non-2xx answer). */
class RollbackWith extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

/** The tenant context of a staff or driver principal (plan 2.5): every field from the token. */
export function tenantContext(principal: Principal, requestId: string): RequestContext {
  if (principal.kind === 'platform') throw new Error('A platform principal has no account');
  return {
    accountId: principal.accountId,
    membershipId: principal.membershipId,
    userId: principal.userId,
    deviceId: principal.kind === 'driver' ? principal.deviceId : null,
    actingCrossTenant: false,
    requestId,
  };
}

/**
 * One unit of work per authenticated request (PLAT-6 plan 2.6; data §4.2). Staff and driver
 * requests run in `withUnitOfWork` on the elx_app pool for the token's account, platform requests
 * in a platform unit of work; the handler and every repository it builds see the same transaction
 * through `getUnitOfWork()`. Commit on a 2xx, rollback on a thrown error or a non-2xx answer. Reads
 * run in the transaction too (one connection per request; revisit at PLAT-14). Global, so it wraps
 * every route interceptor (idempotency reserves inside this transaction).
 */
@Injectable()
export class UnitOfWorkInterceptor implements NestInterceptor {
  constructor(
    @Optional() @Inject(APP_POOL) private readonly appPool?: Pool<AppDatabase> | null,
    @Optional() @Inject(PLATFORM_FRAMES) private readonly platform?: PlatformFrames,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const principal = principalOf(request);
    if (principal === undefined) return next.handle();
    const response = http.getResponse<Response>();
    const handle = async () => {
      const value: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      if (response.statusCode >= 300) throw new RollbackWith(value);
      return value;
    };
    return from(this.run(principal, requestIdOf(request), handle));
  }

  private async run(
    principal: Principal,
    requestId: string,
    handle: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      if (principal.kind === 'platform') {
        if (this.platform === undefined) throw new ApiException('internal_error');
        return await this.platform.runPlatform({ userId: principal.userId, requestId }, handle);
      }
      const pool = this.appPool;
      if (pool === undefined || pool === null) throw new ApiException('internal_error');
      return await withUnitOfWork(pool.db, tenantContext(principal, requestId), handle);
    } catch (error) {
      if (error instanceof RollbackWith) return error.value;
      throw error;
    }
  }
}
