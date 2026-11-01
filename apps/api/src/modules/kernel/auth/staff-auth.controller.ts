import type { Me } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get, HttpCode, Inject, Optional, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import { Operation } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import { Public } from '../tenancy/frame.js';
import { presentMe } from './auth.presenter.js';
import { clearedSessionCookies, sessionCookies } from './cookies.js';
import { staffMe } from './me.js';
import type { RequestFacts } from './request-facts.js';
import { AuthRequest } from './request-facts.js';
import { SessionService } from './sessions.js';

// The staff surface's session doors (PLAT-11 plan 2.4 to 2.6; staff.yaml tag `auth`): refresh,
// logout and `getMe`. Every write carries `X-EL-Client: web` and a web `Origin` (WebClientGuard,
// ADR-0032). Cookies are set here, never by a service.

const refreshSession = operationSchemas.refreshSession;
const logout = operationSchemas.logout;
const getMe = operationSchemas.getMe;

@Controller('v1/staff')
export class StaffAuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Optional() @Inject(PERMISSION_RESOLVER) private readonly resolver?: PermissionResolver,
  ) {}

  /** `refreshSession`: rotates the cookies; a refusal clears them (web.md §3.4). */
  @Post('auth/refresh')
  @Public()
  @HttpCode(204)
  @Operation(refreshSession)
  async refresh(
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const outcome = await this.sessions.refresh('staff', facts);
    if (!outcome.ok) {
      response.append('Set-Cookie', clearedSessionCookies('staff'));
      throw new ApiException(outcome.code);
    }
    response.append('Set-Cookie', sessionCookies('staff', outcome.session));
  }

  /** `logout`: revokes the family and clears the cookies; 204 even when nothing matched. */
  @Post('auth/logout')
  @HttpCode(204)
  @Operation(logout)
  async logout(
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = facts.principal;
    if (principal?.kind !== 'staff') throw new ApiException('unauthenticated');
    await this.sessions.logout(
      'staff',
      {
        userId: principal.userId,
        accountId: principal.accountId,
        membershipId: principal.membershipId,
      },
      facts,
    );
    response.append('Set-Cookie', clearedSessionCookies('staff'));
  }

  @Get('me')
  @Operation(getMe)
  async me(@AuthRequest() facts: RequestFacts): Promise<Me> {
    const principal = facts.principal;
    if (principal === undefined) throw new ApiException('unauthenticated');
    const view = await this.sessions.store.run((tx) => staffMe(tx, principal, this.resolver));
    return presentMe(view);
  }
}
