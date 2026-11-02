import type { DriverShift, ListShifts200 } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Post } from '@nestjs/common';
import type {
  AuditSink,
  ContractInput,
  ListSorts,
  RequestFacts,
} from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  CURSOR_CODEC,
  CursorCodec,
  enumListFilter,
  Feature,
  Idempotent,
  Input,
  Operation,
  OutboxWriter,
  planListPage,
  presentPage,
  shiftStatuses,
} from '../../kernel/public/index.js';
import type { LocationFanout } from '../locations/location-fanout.js';
import { LOCATION_FANOUT } from '../locations/location-fanout.js';
import type { ShiftSortField } from './shifts.repository.js';
import { presentShift } from './shifts.presenter.js';
import { ShiftsService } from './shifts.service.js';

// The staff surface's `shifts` tag (DEL-5 plan 2.3): `listShifts`, `planShift`, `getShift`,
// `cancelShift`, `endShift`. The account is the token's; another account's shift is `404`.
// `x-permission` (`delivery.drivers.read`, `delivery.shifts.manage`) is enforced by PLAT-10's guard;
// no role holding them is site-scoped (roles.yaml), so no door here is `@SiteScoped()`.

const listOp = operationSchemas.listShifts;
const planOp = operationSchemas.planShift;
const getOp = operationSchemas.getShift;
const cancelOp = operationSchemas.cancelShift;
const endOp = operationSchemas.endShift;

export const shiftSorts: ListSorts<ShiftSortField> = {
  fields: { planned_start: 'timestamp', created_at: 'timestamp' },
  default: '-planned_start',
};

@Feature('delivery')
@Controller('v1/staff/shifts')
export class ShiftsController {
  private readonly cursors: CursorCodec;
  private readonly shifts: ShiftsService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
    @Optional() @Inject(LOCATION_FANOUT) fanout?: LocationFanout | null,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.shifts = new ShiftsService({ audit, outbox, fanout: fanout ?? null });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListShifts200> {
    const { query } = input;
    const statuses = enumListFilter(query.status, shiftStatuses, '/query/status');
    const plan = planListPage(this.cursors, {
      operation: 'listShifts',
      reader: `account:${getContext().accountId}`,
      filters: {
        status: query.status,
        site_id: query.site_id,
        driver_id: query.driver_id,
        business_date: query.business_date,
      },
      sorts: shiftSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.shifts.list(plan, {
      statuses,
      siteId: query.site_id,
      driverId: query.driver_id,
      businessDate: query.business_date,
    });
    return presentPage(page, presentShift);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(planOp)
  async plan(
    @Input() input: ContractInput<typeof planOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.plan(input.body, facts));
  }

  @Get(':shift_id')
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<DriverShift> {
    return presentShift(await this.shifts.get(input.params.shift_id));
  }

  @Post(':shift_id/cancel')
  @HttpCode(200)
  @Idempotent()
  @Operation(cancelOp)
  async cancel(
    @Input() input: ContractInput<typeof cancelOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(await this.shifts.cancel(input.params.shift_id, input.body.note, facts));
  }

  @Post(':shift_id/end')
  @HttpCode(200)
  @Idempotent()
  @Operation(endOp)
  async end(
    @Input() input: ContractInput<typeof endOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverShift> {
    return presentShift(
      await this.shifts.endByDispatcher(input.params.shift_id, input.body.note, facts),
    );
  }
}
