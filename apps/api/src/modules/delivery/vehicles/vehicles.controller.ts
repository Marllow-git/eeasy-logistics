import type { ListVehicles200, Vehicle } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Patch, Post } from '@nestjs/common';
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
  Idempotent,
  Input,
  Operation,
  planListPage,
  presentPage,
  Feature,
} from '../../kernel/public/index.js';
import type { VehicleSortField } from './vehicles.repository.js';
import { presentVehicle } from './vehicles.presenter.js';
import { VehiclesService } from './vehicles.service.js';

// The staff surface's `vehicles` tag (DEL-4 plan 2.6): `listVehicles` (`delivery.drivers.read`),
// `createVehicle` and `updateVehicle` (`delivery.vehicles.manage`), enforced by PLAT-10's guard.
// The account is the token's; another account's vehicle is `404`.

const listOp = operationSchemas.listVehicles;
const createOp = operationSchemas.createVehicle;
const updateOp = operationSchemas.updateVehicle;

const vehicleSorts: ListSorts<VehicleSortField> = {
  fields: { plate: 'text', created_at: 'timestamp' },
  default: 'plate',
};

// The `delivery` module's feature gate (DEL-1 plan 2.9; ADR-0006): `403 feature_not_enabled`
// for an account the module is not visible to (K-6).
@Feature('delivery')
@Controller('v1/staff/vehicles')
export class VehiclesController {
  private readonly cursors: CursorCodec;
  private readonly vehicles: VehiclesService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.vehicles = new VehiclesService({ audit });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListVehicles200> {
    const { query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'listVehicles',
      reader: `account:${getContext().accountId}`,
      filters: { active: query.active === undefined ? undefined : String(query.active) },
      sorts: vehicleSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.vehicles.list({ plan, active: query.active });
    return presentPage(page, presentVehicle);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Vehicle> {
    return presentVehicle(await this.vehicles.create(input.body, facts));
  }

  @Patch(':vehicle_id')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Vehicle> {
    return presentVehicle(await this.vehicles.update(input.params.vehicle_id, input.body, facts));
  }
}
