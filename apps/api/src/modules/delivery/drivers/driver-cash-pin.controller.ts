import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import { Controller, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { AuditSink, ContractInput, RequestFacts } from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  DriverSignIn,
  Idempotent,
  Input,
  Operation,
} from '../../kernel/public/index.js';
import { PinCheck } from './cash-pin.js';
import { DriverCashPinService } from './driver-cash-pin.service.js';

// The driver surface's cash PIN doors (DEL-4 plan 2.9; `cash` tag): `delivery.driver.cash`, enforced
// by PLAT-10's guard. The PIN is never echoed, logged or audited; the set door's stored replay is a
// `204` with no body (the request hash is keyed, contracts README §3).

const setOp = operationSchemas.driverSetCashPin;
const verifyOp = operationSchemas.driverVerifyCashPin;

@Controller('v1/driver/cash-pin')
export class DriverCashPinController {
  private readonly pins: DriverCashPinService;

  constructor(
    @Inject(DriverSignIn) signIn: DriverSignIn,
    @Inject(PinCheck) check: PinCheck,
    @Inject(AUDIT_SINK) audit: AuditSink,
  ) {
    this.pins = new DriverCashPinService({ signIn, pins: check, audit });
  }

  /** `driverSetCashPin`: the first PIN with a fresh code, a change with the current PIN. */
  @Put()
  @HttpCode(204)
  @Idempotent()
  @Operation(setOp)
  async set(
    @Input() input: ContractInput<typeof setOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.pins.set(input.body, facts);
  }

  /** `driverVerifyCashPin` (ADR-0034): `204` when right; no idempotency key by contract. */
  @Post('verify')
  @HttpCode(204)
  @Operation(verifyOp)
  async verify(
    @Input() input: ContractInput<typeof verifyOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.pins.verify(input.body.cash_pin, facts);
  }
}
