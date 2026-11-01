import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { from, lastValueFrom } from 'rxjs';
import { APP_POOL } from '../../../database/database.module.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { Principal } from '../auth/principal.js';
import { ApiException } from '../errors/api-exception.js';
import { clientRequestIdOf, serverRequestIdOf } from '../request/request-id.js';
import type { CrossTenantSource } from './cross-tenant.js';
import { crossTenantTarget, isRefusal } from './cross-tenant.js';
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

/** The `User-Agent` header, when it is one string. */
export function userAgentOf(request: Request): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value : null;
}

interface Call {
  readonly principal: Principal;
  readonly request: Request;
  readonly response: Response;
  readonly requestId: string;
  readonly crossTenant: CrossTenantSource | undefined;
  readonly operation: string;
  /** The status a settled handler answers: its own, its `@HttpCode()`, else 201 for POST. */
  readonly successStatus: () => number;
  readonly handle: () => Promise<unknown>;
}

/**
 * One unit of work per authenticated request (PLAT-6 plan 2.6, 2.7; data §4.2). Staff and driver
 * requests run in `withUnitOfWork` on the elx_app pool for the token's account; platform requests
 * in a platform unit of work with no account; a `@CrossTenant()` platform request on the platform
 * pool with `elx.account_id` set to the declared account parameter, after the reason check, and
 * with one committed core_audit_log row per attempt (PLAT-7). The handler and every repository it
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
    const handler = context.getHandler();
    const crossTenant = this.reflector.get<CrossTenantSource | undefined>(CROSS_TENANT, handler);
    const handle = async () => {
      const value: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      if (response.statusCode >= 300) throw new RollbackWith(value);
      return value;
    };
    const successStatus = () => {
      if (response.statusCode !== 200) return response.statusCode;
      const declared = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, handler);
      return declared ?? (request.method === 'POST' ? 201 : 200);
    };
    return from(
      this.run({
        principal,
        request,
        response,
        requestId: serverRequestIdOf(request),
        crossTenant,
        operation: `${context.getClass().name}.${handler.name}`,
        successStatus,
        handle,
      }),
    );
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
      if (call.crossTenant !== undefined) {
        throw new Error('@CrossTenant() is for platform handlers only');
      }
      const pool = this.appPool;
      if (pool === undefined || pool === null) throw new ApiException('internal_error');
      return withUnitOfWork(pool.db, tenantContext(principal, requestId), handle);
    }
    const platform = this.platform;
    if (platform === undefined) throw new ApiException('internal_error');
    if (call.crossTenant === undefined) {
      return platform.runPlatform({ userId: principal.userId, requestId }, handle);
    }
    return this.crossTenant(call, call.crossTenant, platform);
  }

  /**
   * The door (PLAT-6 plan 2.7; PLAT-7 plan 2.4): every attempt leaves exactly one committed row in
   * core_audit_log (identity and tenancy §5). A refusal (reason missing or invalid, account
   * malformed or unknown) is recorded as `platform.cross_tenant.refused` before the error is
   * answered; an admitted call as `platform.cross_tenant.accessed` once the handler has settled,
   * with `outcome` `ok` or `failed` and the status (ruling L-4), so a call that read data and then
   * failed still leaves its row. Both on a transaction of their own (ruling M-5): the request's
   * transaction has committed or rolled back by then and holds no connection.
   */
  private async crossTenant(
    call: Call,
    source: CrossTenantSource,
    platform: PlatformFrames,
  ): Promise<unknown> {
    const { principal, request, requestId, handle } = call;
    const write = (
      action: 'accessed' | 'refused',
      fields: {
        readonly accountId: string | null;
        readonly targetId: string;
        readonly reason: string | null;
        readonly outcome: string;
        readonly status: number;
      },
    ): Promise<void> =>
      this.audit.recordCommitted({
        actorType: 'platform_user',
        actorId: principal.userId,
        accountId: fields.accountId,
        targetType: 'account',
        targetId: fields.targetId,
        action: `platform.cross_tenant.${action}`,
        after: { operation: call.operation, outcome: fields.outcome, status: fields.status },
        reason: fields.reason,
        requestId,
        clientRequestId: clientRequestIdOf(request),
        ip: request.ip ?? null,
        userAgent: userAgentOf(request),
      });

    const target = crossTenantTarget(request, source);
    if (target === undefined) {
      // A query-declared door without its parameter: plain platform work (PLAT-7 plan 2.7).
      return platform.runPlatform({ userId: principal.userId, requestId }, handle);
    }
    if (isRefusal(target)) {
      // Refused before the account was checked, so it may not exist: the row names the attempted
      // id as its target only (a malformed value is never recorded raw) and carries no account.
      await write('refused', {
        accountId: null,
        targetId: target.accountId ?? 'malformed',
        reason: null,
        outcome: target.outcome,
        status: target.error.status,
      });
      throw target.error;
    }
    const context: RequestContext = {
      accountId: target.accountId,
      membershipId: null,
      userId: principal.userId,
      deviceId: null,
      actingCrossTenant: true,
      requestId,
    };
    let admitted = false;
    let value: unknown;
    try {
      value = await platform.runCrossTenant(context, () => {
        admitted = true;
        return handle();
      });
    } catch (error) {
      if (!admitted && error instanceof ApiException && error.code === 'not_found') {
        // The pre-check refused an unknown account: there is no account row to point at.
        await write('refused', {
          accountId: null,
          targetId: target.accountId,
          reason: target.reason,
          outcome: 'not_found',
          status: error.status,
        });
      } else {
        await write('accessed', {
          accountId: target.accountId,
          targetId: target.accountId,
          reason: target.reason,
          outcome: 'failed',
          status: failureStatus(error, call.response),
        });
      }
      throw error;
    }
    await write('accessed', {
      accountId: target.accountId,
      targetId: target.accountId,
      reason: target.reason,
      outcome: 'ok',
      status: call.successStatus(),
    });
    return value;
  }
}

/** The status a failed door call answers: the code's, the handler's own non-2xx, or 500. */
function failureStatus(error: unknown, response: Response): number {
  if (error instanceof RollbackWith) return response.statusCode;
  if (error instanceof ApiException) return error.status;
  if (error instanceof HttpException) return error.getStatus();
  return 500;
}
