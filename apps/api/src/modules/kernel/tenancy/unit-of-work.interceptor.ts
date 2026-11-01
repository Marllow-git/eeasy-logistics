import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { from, lastValueFrom } from 'rxjs';
import { APP_POOL } from '../../../database/database.module.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { Principal } from '../auth/principal.js';
import { ApiException } from '../errors/api-exception.js';
import { requestIdOf } from '../request/request-id.js';
import { crossTenantTarget } from './cross-tenant.js';
import type { PlatformFrames } from './frame.js';
import { CROSS_TENANT, PLATFORM_FRAMES, principalOf } from './frame.js';

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

interface Call {
  readonly principal: Principal;
  readonly request: Request;
  readonly requestId: string;
  readonly crossTenant: boolean;
  readonly operation: string;
  readonly handle: () => Promise<unknown>;
}

/**
 * One unit of work per authenticated request (PLAT-6 plan 2.6, 2.7; data §4.2). Staff and driver
 * requests run in `withUnitOfWork` on the elx_app pool for the token's account; platform requests
 * in a platform unit of work with no account; a `@CrossTenant()` platform request on the platform
 * pool with `elx.account_id` set to the route's `:accountId`, after the reason check and with one
 * audit event emitted in that transaction before the handler. The handler and every repository it
 * builds see the same transaction through `getUnitOfWork()`. Commit on a 2xx, rollback on a thrown
 * error or a non-2xx answer. Reads run in the transaction too (one connection per request; revisit
 * at PLAT-14). Global, so it wraps every route interceptor (idempotency reserves inside it).
 */
@Injectable()
export class UnitOfWorkInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Optional() @Inject(APP_POOL) private readonly appPool?: Pool<AppDatabase> | null,
    @Optional() @Inject(PLATFORM_FRAMES) private readonly platform?: PlatformFrames,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const principal = principalOf(request);
    if (principal === undefined) return next.handle();
    const response = http.getResponse<Response>();
    const crossTenant =
      this.reflector.get<boolean | undefined>(CROSS_TENANT, context.getHandler()) === true;
    const handle = async () => {
      const value: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      if (response.statusCode >= 300) throw new RollbackWith(value);
      return value;
    };
    const operation = `${context.getClass().name}.${context.getHandler().name}`;
    const requestId = requestIdOf(request);
    return from(this.run({ principal, request, requestId, crossTenant, operation, handle }));
  }

  private async run(call: Call): Promise<unknown> {
    try {
      return await this.open(call);
    } catch (error) {
      if (error instanceof RollbackWith) return error.value;
      throw error;
    }
  }

  private open(call: Call): Promise<unknown> {
    const { principal, requestId, handle } = call;
    if (principal.kind !== 'platform') {
      if (call.crossTenant) throw new Error('@CrossTenant() is for platform handlers only');
      const pool = this.appPool;
      if (pool === undefined || pool === null) throw new ApiException('internal_error');
      return withUnitOfWork(pool.db, tenantContext(principal, requestId), handle);
    }
    const platform = this.platform;
    if (platform === undefined) throw new ApiException('internal_error');
    if (!call.crossTenant) {
      return platform.runPlatform({ userId: principal.userId, requestId }, handle);
    }
    const target = crossTenantTarget(call.request);
    const context: RequestContext = {
      accountId: target.accountId,
      membershipId: null,
      userId: principal.userId,
      deviceId: null,
      actingCrossTenant: true,
      requestId,
    };
    return platform.runCrossTenant(context, async () => {
      await this.audit.record({
        kind: 'cross_tenant_access',
        actor: principal.userId,
        accountId: target.accountId,
        operation: call.operation,
        reason: target.reason,
        requestId,
        at: new Date().toISOString(),
      });
      return handle();
    });
  }
}
