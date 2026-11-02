import type { Driver, ListDrivers200 } from '@eeasy-logistics/contracts/staff/schemas';
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
  DriverIdentities,
  driverStatuses,
  enumListFilter,
  Idempotent,
  Input,
  Operation,
  OutboxWriter,
  planListPage,
  presentPage,
  textQuery,
} from '../../kernel/public/index.js';
import { DRIVER_APP_URL } from '../delivery.tokens.js';
import { presentDriver } from './drivers.presenter.js';
import type { DriverSortField } from './drivers.service.js';
import { DriversService } from './drivers.service.js';

// The staff surface's `drivers` tag, leg 1 (DEL-4 plan 2.2 to 2.4): `listDrivers`, `createDriver`,
// `getDriver`, `updateDriver`. The account is the token's; a driver of another account is `404`.
// `x-permission` (`delivery.drivers.read`, `delivery.drivers.manage`) is enforced by PLAT-10's
// guard. Drivers are an account resource: no door here is site-scoped (no role holding these
// permissions is site-scoped, roles.yaml).

const listOp = operationSchemas.listDrivers;
const createOp = operationSchemas.createDriver;
const getOp = operationSchemas.getDriver;
const updateOp = operationSchemas.updateDriver;

const driverSorts: ListSorts<DriverSortField> = {
  fields: { created_at: 'timestamp', name: 'text', status: 'text' },
  default: '-created_at',
};

@Controller('v1/staff/drivers')
export class DriversController {
  private readonly cursors: CursorCodec;
  private readonly drivers: DriversService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    identities: DriverIdentities,
    @Inject(DRIVER_APP_URL) appUrl: string,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.drivers = new DriversService({ identities, audit, outbox, appUrl });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListDrivers200> {
    const { query } = input;
    // Filters are checked before the cursor, so a bad one answers on its own pointer.
    const statuses = enumListFilter(query.status, driverStatuses, '/query/status');
    const q = textQuery(query.q);
    const plan = planListPage(this.cursors, {
      operation: 'listDrivers',
      reader: `account:${getContext().accountId}`,
      filters: {
        status: query.status,
        site_id: query.site_id,
        cash_blocked: query.cash_blocked === undefined ? undefined : String(query.cash_blocked),
        q,
      },
      sorts: driverSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.drivers.list({
      plan,
      statuses,
      homeSiteId: query.site_id,
      cashBlocked: query.cash_blocked,
      q,
    });
    return presentPage(page, presentDriver);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Driver> {
    return presentDriver(await this.drivers.create(input.body, facts));
  }

  @Get(':driver_id')
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<Driver> {
    return presentDriver(await this.drivers.get(input.params.driver_id));
  }

  @Patch(':driver_id')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Driver> {
    return presentDriver(await this.drivers.update(input.params.driver_id, input.body, facts));
  }
}
