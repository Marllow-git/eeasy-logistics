import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type { AuditSink, ContractInput, RequestFacts } from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  DriverIdentities,
  DriverSignIn,
  Input,
  Operation,
  Public,
} from '../../kernel/public/index.js';
import { presentDriverSession } from './driver-auth.presenter.js';
import { DriverSessionsService } from './driver-sessions.service.js';

// The driver surface's `auth` tag (DEL-4 plan 2.7, 2.8, 2.12): the anonymous OTP doors (no
// `X-EL-Client`: the app is not a web client) and the bearer session doors. The account of every
// bearer door is the token's; the anonymous doors find it from the phone, never from the request.

const requestOtpOp = operationSchemas.driverRequestOtp;
const verifyOtpOp = operationSchemas.driverVerifyOtp;

@Controller('v1/driver')
export class DriverAuthController {
  private readonly sessions: DriverSessionsService;

  constructor(
    @Inject(DriverSignIn) private readonly signIn: DriverSignIn,
    @Inject(AUDIT_SINK) audit: AuditSink,
    identities: DriverIdentities,
  ) {
    this.sessions = new DriverSessionsService({ signIn, identities, audit });
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
}
