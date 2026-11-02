import type { DriverListShifts200, DriverShift } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Post } from '@nestjs/common';
import type { AuditSink, ContractInput, RequestFacts } from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  CURSOR_CODEC,
  CursorCodec,
  enumListFilter,
  Idempotent,
  Input,
  Operation,
  OutboxWriter,
  planListPage,
  presentPage,
  shiftStatuses,
} from '../../kernel/public/index.js';
import { ReplayRoute } from '../driver-auth/app-version.guard.js';
import { shiftSorts } from './shifts.controller.js';
import { presentShift } from './shifts.presenter.js';
import { ShiftsService } from './shifts.service.js';

// The driver surface's `shifts` tag (DEL-5 plan 2.4; driver app §6.1): `driverListShifts`,
// `driverStartShift`, `driverPauseShift`, `driverResumeShift`, `driverEndShift`. The driver is the
// token's (`tokenDriver()`, DEL-4 M-2); another driver's shift is `404`. Pause, resume and end are
// replayed from the app's outbox: `@ReplayRoute()` lets them past the version guard, and the same
// `Idempotency-Key` answers the stored result while a new key on a moved shift is `409
// invalid_transition` with `details.current_status`. `started_at`/`ended_at` are server times.

const listOp = operationSchemas.driverListShifts;
const startOp = operationSchemas.driverStartShift;
const pauseOp = operationSchemas.driverPauseShift;
const resumeOp = operationSchemas.driverResumeShift;
const endOp = operationSchemas.driverEndShift;

@Controller('v1/driver/shifts')
export class DriverShiftsController {
  private readonly cursors: CursorCodec;
  private readonly shifts: ShiftsService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.shifts = new ShiftsService({ audit, outbox });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<DriverListShifts200> {
    const { query } = input;
    const statuses = enumListFilter(query.status, shiftStatuses, '/query/status');
    const context = getContext();
    const plan = planListPage(this.cursors, {
      operation: 'driverListShifts',
      reader: `membership:${context.membershipId ?? ''}`,
      filters: { status: query.status },
      sorts: shiftSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    return presentPage(await this.shifts.driverList(plan, statuses), presentShift);
  }

  @Post('start')
  @HttpCode(200)
  @Idempotent()
  @Operation(startOp)
  async start(
    @Input() input: ContractInput<typeof startOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.start(input.body, facts));
  }

  @Post(':shift_id/pause')
  @HttpCode(200)
  @Idempotent()
  @ReplayRoute()
  @Operation(pauseOp)
  async pause(
    @Input() input: ContractInput<typeof pauseOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.driverMove(input.params.shift_id, 'paused', facts));
  }

  @Post(':shift_id/resume')
  @HttpCode(200)
  @Idempotent()
  @ReplayRoute()
  @Operation(resumeOp)
  async resume(
    @Input() input: ContractInput<typeof resumeOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.driverMove(input.params.shift_id, 'active', facts));
  }

  @Post(':shift_id/end')
  @HttpCode(200)
  @Idempotent()
  @ReplayRoute()
  @Operation(endOp)
  async end(
    @Input() input: ContractInput<typeof endOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.driverMove(input.params.shift_id, 'ended', facts));
  }
}
