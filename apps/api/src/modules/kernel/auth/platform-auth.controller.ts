import type {
  PlatformMe,
  TotpChallenge,
  TotpEnrolment,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { Controller, Get, HttpCode, Inject, Optional, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import { Public } from '../tenancy/frame.js';
import { presentPlatformMe } from './auth.presenter.js';
import { clearedSessionCookies, sessionCookies } from './cookies.js';
import { platformMe } from './me.js';
import type { PlatformSession, TotpChallengeStep } from './platform-sign-in.js';
import { PlatformSignIn } from './platform-sign-in.js';
import type { RequestFacts } from './request-facts.js';
import { AuthRequest } from './request-facts.js';
import { SessionService } from './sessions.js';

// The platform surface's auth doors (PLAT-11 plan 2.4, 2.6, 2.9, 2.10; platform.yaml tag `auth`):
// email and password, then TOTP (enrolment on first use), the sliding 12-hour refresh, logout and
// `platformGetMe`. Every write carries `X-EL-Client: web` and the console's `Origin` (ADR-0038).
// Cookies are set here, never by a service; the otpauth URI is answered once and never logged.

const login = operationSchemas.platformLogin;
const verifyTotp = operationSchemas.platformVerifyTotp;
const acceptInvitation = operationSchemas.platformAcceptInvitation;
const enrolTotp = operationSchemas.platformEnrolTotp;
const confirmTotp = operationSchemas.platformConfirmTotp;
const redeemLink = operationSchemas.platformRedeemEnrolmentLink;
const refresh = operationSchemas.platformRefresh;
const logout = operationSchemas.platformLogout;
const getMe = operationSchemas.platformGetMe;

function presentChallenge(step: TotpChallengeStep): TotpChallenge {
  return { challenge_id: step.challengeId, totp_enrolment_required: step.totpEnrolmentRequired };
}

@Controller('v1/platform')
export class PlatformAuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PlatformSignIn) private readonly signIn: PlatformSignIn,
    @Optional() @Inject(PERMISSION_RESOLVER) private readonly resolver?: PermissionResolver,
  ) {}

  /** `platformLogin`: a TOTP challenge, never a cookie. */
  @Post('auth/login')
  @Public()
  @HttpCode(200)
  @Operation(login)
  async login(
    @Input() input: ContractInput<typeof login>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<TotpChallenge> {
    const step = await this.signIn.login(
      { email: input.body.email, password: input.body.password },
      facts,
    );
    return presentChallenge(step);
  }

  @Post('auth/totp/verify')
  @Public()
  @HttpCode(200)
  @Operation(verifyTotp)
  async verify(
    @Input() input: ContractInput<typeof verifyTotp>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformMe> {
    const started = await this.signIn.verify(
      { challengeId: input.body.challenge_id, code: input.body.code },
      facts,
    );
    return this.#answer(started, response);
  }

  @Post('auth/invitations/accept')
  @Public()
  @HttpCode(200)
  @Operation(acceptInvitation)
  async accept(
    @Input() input: ContractInput<typeof acceptInvitation>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<TotpChallenge> {
    const step = await this.signIn.acceptInvitation(
      { token: input.body.token, name: input.body.name, password: input.body.password },
      facts,
    );
    return presentChallenge(step);
  }

  /** `platformEnrolTotp`: the otpauth URI, once (not idempotent-keyed, never logged). */
  @Post('auth/totp/enrol')
  @Public()
  @HttpCode(200)
  @Operation(enrolTotp)
  async enrol(@Input() input: ContractInput<typeof enrolTotp>): Promise<TotpEnrolment> {
    const enrolment = await this.signIn.enrol({ challengeId: input.body.challenge_id });
    return { challenge_id: enrolment.challengeId, otpauth_uri: enrolment.uri };
  }

  @Post('auth/totp/confirm')
  @Public()
  @HttpCode(200)
  @Operation(confirmTotp)
  async confirm(
    @Input() input: ContractInput<typeof confirmTotp>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformMe> {
    const started = await this.signIn.confirm(
      { challengeId: input.body.challenge_id, code: input.body.code },
      facts,
    );
    return this.#answer(started, response);
  }

  /** `platformRedeemEnrolmentLink` (PLAT-13 M-2): the reset's emailed link plus the password. */
  @Post('auth/enrolment-links/redeem')
  @Public()
  @HttpCode(200)
  @Operation(redeemLink)
  async redeemLink(
    @Input() input: ContractInput<typeof redeemLink>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<TotpChallenge> {
    const step = await this.signIn.redeemEnrolmentLink(
      { token: input.body.token, password: input.body.password },
      facts,
    );
    return presentChallenge(step);
  }

  /** `platformRefresh`: rotates the cookies and slides the 12-hour idle expiry; a refusal clears them. */
  @Post('auth/refresh')
  @Public()
  @HttpCode(204)
  @Operation(refresh)
  async refresh(
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const outcome = await this.sessions.refresh('platform', facts);
    if (!outcome.ok) {
      response.append('Set-Cookie', clearedSessionCookies('platform'));
      throw new ApiException(outcome.code);
    }
    response.append('Set-Cookie', sessionCookies('platform', outcome.session));
  }

  /** `platformLogout`: revokes the family and clears the cookies; 204 even when nothing matched. */
  @Post('auth/logout')
  @HttpCode(204)
  @Operation(logout)
  async logout(
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = facts.principal;
    if (principal?.kind !== 'platform') throw new ApiException('unauthenticated');
    await this.sessions.logout(
      'platform',
      { userId: principal.userId, accountId: null, membershipId: null },
      facts,
    );
    response.append('Set-Cookie', clearedSessionCookies('platform'));
  }

  @Get('me')
  @Operation(getMe)
  async me(@AuthRequest() facts: RequestFacts): Promise<PlatformMe> {
    const principal = facts.principal;
    if (principal === undefined) throw new ApiException('unauthenticated');
    const view = await this.sessions.store.run((tx) => platformMe(tx, principal, this.resolver));
    return presentPlatformMe(view);
  }

  #answer(started: PlatformSession, response: Response): PlatformMe {
    response.append('Set-Cookie', sessionCookies('platform', started.session));
    return presentPlatformMe(started.me);
  }
}
