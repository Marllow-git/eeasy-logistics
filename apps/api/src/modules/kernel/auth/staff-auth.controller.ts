import type { LoginResponse, Me } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get, HttpCode, Inject, Optional, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import { Public } from '../tenancy/frame.js';
import { presentLoginStep, presentMe } from './auth.presenter.js';
import { clearedSessionCookies, sessionCookies } from './cookies.js';
import { staffMe } from './me.js';
import { PasswordResets } from './password-resets.js';
import type { RequestFacts } from './request-facts.js';
import { AuthRequest } from './request-facts.js';
import { SessionService } from './sessions.js';
import type { StartedSession } from './sign-in.js';
import { StaffSignIn } from './sign-in.js';

// The staff surface's auth doors (PLAT-11 plan 2.4 to 2.7, 2.10; staff.yaml tag `auth`): sign-in,
// account selection and switch, invitations, resets, refresh, logout and `getMe`. Every write
// carries `X-EL-Client: web` and a web `Origin` (WebClientGuard, ADR-0032). Cookies are set here,
// never by a service. The second-factor doors arrive in leg 2 (plan item F).

const acceptInvitation = operationSchemas.acceptInvitation;
const login = operationSchemas.login;
const selectAccount = operationSchemas.selectAccount;
const switchAccount = operationSchemas.switchAccount;
const refreshSession = operationSchemas.refreshSession;
const logout = operationSchemas.logout;
const requestPasswordReset = operationSchemas.requestPasswordReset;
const confirmPasswordReset = operationSchemas.confirmPasswordReset;
const getMe = operationSchemas.getMe;

@Controller('v1/staff')
export class StaffAuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(StaffSignIn) private readonly signIn: StaffSignIn,
    @Inject(PasswordResets) private readonly resets: PasswordResets,
    @Optional() @Inject(PERMISSION_RESOLVER) private readonly resolver?: PermissionResolver,
  ) {}

  @Post('auth/invitations/accept')
  @Public()
  @HttpCode(200)
  @Operation(acceptInvitation)
  async accept(
    @Input() input: ContractInput<typeof acceptInvitation>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const started = await this.signIn.acceptInvitation(
      {
        token: input.body.token,
        name: input.body.name,
        password: input.body.password,
        locale: input.body.locale,
      },
      facts,
    );
    return this.#answer(started, response);
  }

  /** `login`: the session, the account list, or the factor step (no cookie before the session). */
  @Post('auth/login')
  @Public()
  @HttpCode(200)
  @Operation(login)
  async login(
    @Input() input: ContractInput<typeof login>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const step = await this.signIn.login(
      { email: input.body.email, password: input.body.password },
      facts,
    );
    if (step.kind === 'session')
      response.append('Set-Cookie', sessionCookies('staff', step.session));
    return presentLoginStep(step);
  }

  @Post('auth/select-account')
  @Public()
  @HttpCode(200)
  @Operation(selectAccount)
  async select(
    @Input() input: ContractInput<typeof selectAccount>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const started = await this.signIn.selectAccount(
      { selectionToken: input.body.selection_token, membershipId: input.body.membership_id },
      facts,
    );
    return this.#answer(started, response);
  }

  @Post('auth/switch-account')
  @HttpCode(200)
  @Operation(switchAccount)
  async switch(
    @Input() input: ContractInput<typeof switchAccount>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const principal = facts.principal;
    if (principal === undefined) throw new ApiException('unauthenticated');
    const started = await this.signIn.switchAccount(principal, input.body.membership_id, facts);
    return this.#answer(started, response);
  }

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

  /** `requestPasswordReset`: always 202 (unless a budget refuses). */
  @Post('auth/password-reset/request')
  @Public()
  @HttpCode(202)
  @Operation(requestPasswordReset)
  async requestReset(
    @Input() input: ContractInput<typeof requestPasswordReset>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.resets.request({ email: input.body.email }, facts);
  }

  @Post('auth/password-reset/confirm')
  @Public()
  @HttpCode(204)
  @Operation(confirmPasswordReset)
  async confirmReset(
    @Input() input: ContractInput<typeof confirmPasswordReset>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.resets.confirm({ token: input.body.token, password: input.body.password }, facts);
  }

  @Get('me')
  @Operation(getMe)
  async me(@AuthRequest() facts: RequestFacts): Promise<Me> {
    const principal = facts.principal;
    if (principal === undefined) throw new ApiException('unauthenticated');
    const view = await this.sessions.store.run((tx) => staffMe(tx, principal, this.resolver));
    return presentMe(view);
  }

  #answer(started: StartedSession, response: Response): Me {
    response.append('Set-Cookie', sessionCookies('staff', started.session));
    return presentMe(started.me);
  }
}
