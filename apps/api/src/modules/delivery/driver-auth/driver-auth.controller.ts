import type {
  DriverDevice,
  DriverMe,
  DriverSession,
  TokenPair,
} from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import { Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { AuditSink, ContractInput, RequestFacts } from '../../kernel/public/index.js';
import {
  ApiException,
  AUDIT_SINK,
  AuthRequest,
  DriverIdentities,
  DriverSignIn,
  Idempotent,
  Input,
  Operation,
  Public,
} from '../../kernel/public/index.js';
import { DRIVER_MIN_APP_VERSION } from '../delivery.tokens.js';
import type { MinAppVersions } from './app-version.guard.js';
import {
  presentDriverMe,
  presentDriverSession,
  presentOwnDevice,
  presentTokens,
} from './driver-auth.presenter.js';
import { DriverSelfService } from './driver-self.service.js';
import { DriverSessionsService } from './driver-sessions.service.js';

// The driver surface's `auth` tag (DEL-4 plan 2.7, 2.8, 2.12): the anonymous OTP doors (no
// `X-EL-Client`: the app is not a web client) and the bearer session doors. The account of every
// bearer door is the token's; the anonymous doors find it from the phone, never from the request.

const requestOtpOp = operationSchemas.driverRequestOtp;
const verifyOtpOp = operationSchemas.driverVerifyOtp;
const refreshOp = operationSchemas.driverRefresh;
const logoutOp = operationSchemas.driverLogout;
const meOp = operationSchemas.driverGetMe;
const pushTokenOp = operationSchemas.driverUpdatePushToken;

@Controller('v1/driver')
export class DriverAuthController {
  private readonly sessions: DriverSessionsService;
  private readonly self: DriverSelfService;

  constructor(
    @Inject(DriverSignIn) private readonly signIn: DriverSignIn,
    @Inject(AUDIT_SINK) audit: AuditSink,
    identities: DriverIdentities,
    @Inject(DRIVER_MIN_APP_VERSION) minAppVersion: MinAppVersions,
  ) {
    this.sessions = new DriverSessionsService({ signIn, identities, audit });
    this.self = new DriverSelfService({ signIn, identities, minAppVersion });
  }

  /** `driverRequestOtp`: `202` for any phone (identity and tenancy §8). */
  @Post('auth/otp/request')
  @Public()
  @HttpCode(202)
  @Operation(requestOtpOp)
  async requestOtp(
    @Input() input: ContractInput<typeof requestOtpOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.signIn.requestCode({
      phone: input.body.phone,
      locale: input.body.locale ?? 'ar',
      ip: facts.ip,
    });
  }

  /** `driverVerifyOtp`: the session on this device, or one `401 otp_invalid` for every refusal. */
  @Post('auth/otp/verify')
  @Public()
  @HttpCode(200)
  @Operation(verifyOtpOp)
  async verifyOtp(
    @Input() input: ContractInput<typeof verifyOtpOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverSession> {
    return presentDriverSession(await this.sessions.signIn(input.body, facts));
  }

  /**
   * `driverRefresh` (plan 2.8): the refresh token and the app's device id from the body; a refusal
   * answers its code after any revocation it caused committed.
   */
  @Post('auth/refresh')
  @Public()
  @HttpCode(200)
  @Operation(refreshOp)
  async refresh(
    @Input() input: ContractInput<typeof refreshOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<TokenPair> {
    const outcome = await this.signIn.refresh(
      { refreshToken: input.body.refresh_token, deviceId: input.body.device_id },
      facts,
    );
    if (!outcome.ok) throw new ApiException(outcome.code);
    return presentTokens(outcome.session);
  }

  /** `driverLogout`: this device's families end; `204` even when none was live. */
  @Post('auth/logout')
  @HttpCode(204)
  @Operation(logoutOp)
  async logout(@AuthRequest() facts: RequestFacts): Promise<void> {
    await this.self.logout(facts);
  }

  /** `driverGetMe`: the driver, this device, the cash state and the app's settings. */
  @Get('me')
  @Operation(meOp)
  async me(): Promise<DriverMe> {
    return presentDriverMe(await this.self.me());
  }

  /** `driverUpdatePushToken`: this device's Expo push token replaced. */
  @Put('devices/current/push-token')
  @HttpCode(200)
  @Idempotent()
  @Operation(pushTokenOp)
  async updatePushToken(@Input() input: ContractInput<typeof pushTokenOp>): Promise<DriverDevice> {
    return presentOwnDevice(await this.self.updatePushToken(input.body.push_token));
  }
}
