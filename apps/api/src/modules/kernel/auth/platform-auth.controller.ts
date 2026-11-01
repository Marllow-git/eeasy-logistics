import type { PlatformMe } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import { Operation } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import { presentPlatformMe } from './auth.presenter.js';
import { platformMe } from './me.js';
import type { RequestFacts } from './request-facts.js';
import { AuthRequest } from './request-facts.js';
import { SessionService } from './sessions.js';

// The platform surface's session doors (PLAT-11 plan 2.4; platform.yaml tag `auth`): `platformGetMe`
// in leg 1; sign-in, TOTP, refresh and logout arrive in leg 2 (plan item G).

const getMe = operationSchemas.platformGetMe;

@Controller('v1/platform')
export class PlatformAuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Optional() @Inject(PERMISSION_RESOLVER) private readonly resolver?: PermissionResolver,
  ) {}

  @Get('me')
  @Operation(getMe)
  async me(@AuthRequest() facts: RequestFacts): Promise<PlatformMe> {
    const principal = facts.principal;
    if (principal === undefined) throw new ApiException('unauthenticated');
    const view = await this.sessions.store.run((tx) => platformMe(tx, principal, this.resolver));
    return presentPlatformMe(view);
  }
}
