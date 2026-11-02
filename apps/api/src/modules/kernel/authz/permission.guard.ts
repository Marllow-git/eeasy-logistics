import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuditActorType } from '../schema/audit-log.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { Principal } from '../auth/principal.js';
import { requestSurface } from '../auth/surfaces.js';
import { operationOf } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import { clientRequestIdOf, serverRequestIdOf } from '../request/request-id.js';
import { IS_PUBLIC, principalOf } from '../tenancy/frame.js';
import { userAgentOf } from '../tenancy/unit-of-work.interceptor.js';
import { DenialAuditThrottle } from './denial-throttle.js';
import type { BoundOperation } from './operation-routes.check.js';
import { boundOperation, doorPermissions } from './operation-routes.check.js';
import type { PermissionResolver } from './permission-resolver.js';
import { PERMISSION_RESOLVER } from './permission-resolver.js';
import type { SiteScopedSource } from './site-scope.js';
import {
  SITE_SCOPED,
  assertSiteInScope,
  normaliseSiteIds,
  setRequestSiteScope,
} from './site-scope.js';

/** Methods that change nothing: the account-status read skips them (`assertAccountWritable`). */
const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const actorTypes: Readonly<Record<Principal['kind'], AuditActorType>> = {
  staff: 'user',
  driver: 'driver',
  platform: 'platform_user',
};

/**
 * The denials a contract answers with a code of their own instead of `forbidden` (PLAT-13 plan
 * 2.6): a caller who manages feature flags but may not change a rollout mode (a platform admin) is
 * told `rollout_change_forbidden`, so the console can explain; anyone else gets `forbidden`.
 */
const explainedDenials: Readonly<
  Record<string, { readonly holder: string; readonly code: 'rollout_change_forbidden' }>
> = {
  'platform.rollout.manage': { holder: 'platform.flags.manage', code: 'rollout_change_forbidden' },
};

/**
 * The global permission guard (PLAT-10 plan 2.5; identity and tenancy §2; contracts README §1),
 * after `TenancyGuard`. The permission an operation requires comes only from its contract: the
 * `x-permission` of the generated `operationSchemas` entry the handler binds with `@Operation()`
 * (a non-public handler without one never boots, `OperationRoutesCheck`). The doors pass for a
 * principal of the operation's surface; any other operation needs a principal whose bundles hold
 * the permission, else `403 forbidden` with no detail (owner question 2 default) and one committed
 * `core.authorization.denied` audit row per principal and operation per minute (plan 2.8). A
 * permission held only through site-scoped bundles restricts the request to the token's sites
 * (plan 2.6, `site-scope.ts`): `404 not_found` outside them or with none.
 *
 * Recipient operations are granted by the token's `purpose`, which the recipient verifier (DEL
 * order) owns, so they are skipped here; the public surface (API-key scopes, wave 4) is refused.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  readonly #logger = new Logger('Permissions');
  #recipientLogged = false;

  private readonly accounts: AccountStore | null;

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    private readonly throttle: DenialAuditThrottle,
    @Optional() @Inject(PERMISSION_RESOLVER) private readonly resolver?: PermissionResolver,
    @Optional() @Inject(PLATFORM_POOL) pool?: Parameters<typeof accountStoreOnPool>[0],
  ) {
    this.accounts = accountStoreOnPool(pool ?? null);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const surface = requestSurface(request);
    if (surface === 'recipient') {
      if (!this.#recipientLogged) {
        this.#recipientLogged = true;
        this.#logger.log('Recipient operations are granted by the token purpose, not by roles');
      }
      return true;
    }
    const principal = principalOf(request);
    // TenancyGuard ran first: a non-public request here has a principal of its surface.
    if (principal === undefined) throw new ApiException('unauthenticated');
    const operation = boundOperation(operationOf(context.getHandler()));
    if (
      operation === undefined ||
      surface === 'public' ||
      operation.surface !== surface ||
      principal.kind !== surface
    ) {
      throw new ApiException('forbidden');
    }
    if (doorPermissions.has(operation.permission)) return true;
    const resolver = this.resolver;
    if (resolver === undefined) throw new ApiException('internal_error');
    const grants = resolver.grantsOf(principal);
    const grant = grants.get(operation.permission);
    if (grant === undefined) {
      await this.recordDenial(request, principal, operation);
      const explained = explainedDenials[operation.permission];
      throw new ApiException(
        explained !== undefined && grants.has(explained.holder) ? explained.code : 'forbidden',
      );
    }
    await this.assertAccountWritable(request, principal);
    if (grant === 'sites') {
      // Held only through site-scoped bundles (plan 2.6): the declared site must be one of the
      // token's sites, an empty list sees nothing, and the handler's lists filter by them.
      const source = this.reflector.get<SiteScopedSource | undefined>(
        SITE_SCOPED,
        context.getHandler(),
      );
      const sites = normaliseSiteIds(principal.sites);
      assertSiteInScope(request, source, sites);
      setRequestSiteScope(request, sites);
    }
    return true;
  }

  /**
   * A write by a staff or driver token on an account that is no longer writable (PLAT-13 plan 2.7;
   * errors.md `account_suspended`: "any write, refresh or API key call on a suspended account").
   * Access tokens are verified by signature only and live 15 minutes (identity and tenancy §4), so
   * this is the one read that closes that window for writes: the token's account status on the
   * platform pool, before the request's unit of work opens. `suspended` is `403
   * account_suspended`; `closed` (every session already revoked) is `401 token_invalid`. Reads stay
   * open for the token's lifetime (the data is kept, K-2). Without the platform pool (outside
   * production) there is nothing to read and the check is skipped.
   */
  private async assertAccountWritable(request: Request, principal: Principal): Promise<void> {
    if (principal.kind === 'platform' || safeMethods.has(request.method)) return;
    const store = this.accounts;
    if (store === null) return;
    const account = await store.run((accounts) => accounts.find(principal.accountId));
    // A token's account always has a row (accounts are never deleted, K-7); none is left to the
    // handler, as before this check.
    if (account?.status === 'suspended') throw new ApiException('account_suspended');
    if (account?.status === 'closed') throw new ApiException('token_invalid');
  }

  /**
   * One committed row per principal and operation per minute. A failed write is logged and the
   * request still answers 403: a refusal is the safe outcome, and the throttle already leaves
   * repeats unaudited by design.
   */
  private async recordDenial(
    request: Request,
    principal: Principal,
    operation: BoundOperation,
  ): Promise<void> {
    const accountId = principal.kind === 'platform' ? null : principal.accountId;
    const key = `${principal.kind}:${principal.userId}:${accountId ?? '-'}:${operation.operationId}`;
    if (!this.throttle.admit(key)) return;
    try {
      await this.audit.recordCommitted({
        actorType: actorTypes[principal.kind],
        actorId: principal.userId,
        accountId,
        targetType: 'operation',
        targetId: operation.operationId,
        action: 'core.authorization.denied',
        after: {
          operation: operation.operationId,
          permission: operation.permission,
          surface: operation.surface,
          roles: [...principal.roles],
        },
        requestId: serverRequestIdOf(request),
        clientRequestId: clientRequestIdOf(request),
        ip: request.ip ?? null,
        userAgent: userAgentOf(request),
      });
    } catch (error) {
      this.#logger.error(
        `Denial audit not written for ${operation.operationId}: ${(error as Error).message}`,
      );
    }
  }
}
