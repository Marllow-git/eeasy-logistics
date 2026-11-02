import type {
  Driver,
  DriverDevice,
  ListDriverDevices200,
  ListDrivers200,
} from '@eeasy-logistics/contracts/staff/schemas';
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
import { presentDriverDevice } from './driver-devices.presenter.js';
import { DriverDevicesService } from './driver-devices.service.js';
import { presentDriver } from './drivers.presenter.js';
import type { DriverSortField } from './drivers.service.js';
import { DriversService } from './drivers.service.js';

// The staff surface's `drivers` tag, leg 1 (DEL-4 plan 2.2 to 2.5): `listDrivers`, `createDriver`,
// `getDriver`, `updateDriver`, `listDriverDevices`, `revokeDriverDevice`, `resetDriverCashPin`. The account is the token's; a driver of another account is `404`.
// `x-permission` (`delivery.drivers.read`, `delivery.drivers.manage`) is enforced by PLAT-10's
// guard. Drivers are an account resource: no door here is site-scoped (no role holding these
// permissions is site-scoped, roles.yaml).

const listOp = operationSchemas.listDrivers;
const createOp = operationSchemas.createDriver;
const getOp = operationSchemas.getDriver;
const updateOp = operationSchemas.updateDriver;
const devicesOp = operationSchemas.listDriverDevices;
const revokeDeviceOp = operationSchemas.revokeDriverDevice;
const resetPinOp = operationSchemas.resetDriverCashPin;

const deviceSorts: ListSorts<'created_at'> = {
  fields: { created_at: 'timestamp' },
  default: '-created_at',
};

const driverSorts: ListSorts<DriverSortField> = {
  fields: { created_at: 'timestamp', name: 'text', status: 'text' },
  default: '-created_at',
};

@Controller('v1/staff/drivers')
export class DriversController {
  private readonly cursors: CursorCodec;
  private readonly drivers: DriversService;
  private readonly devices: DriverDevicesService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    identities: DriverIdentities,
    @Inject(DRIVER_APP_URL) appUrl: string,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.drivers = new DriversService({ identities, audit, outbox, appUrl });
    this.devices = new DriverDevicesService({ identities, audit });
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

  @Get(':driver_id/devices')
  @Operation(devicesOp)
  async listDevices(
    @Input() input: ContractInput<typeof devicesOp>,
  ): Promise<ListDriverDevices200> {
    const { params, query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'listDriverDevices',
      reader: `account:${getContext().accountId}`,
      filters: { driver_id: params.driver_id },
      sorts: deviceSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.devices.list(params.driver_id, plan);
    return presentPage(page, presentDriverDevice);
  }

  @Post(':driver_id/devices/:device_id/revoke')
  @HttpCode(200)
  @Idempotent()
  @Operation(revokeDeviceOp)
  async revokeDevice(
    @Input() input: ContractInput<typeof revokeDeviceOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<DriverDevice> {
    const { driver_id: driverId, device_id: deviceId } = input.params;
    return presentDriverDevice(await this.devices.revoke(driverId, deviceId, facts));
  }

  @Post(':driver_id/cash-pin/reset')
  @HttpCode(204)
  @Idempotent()
  @Operation(resetPinOp)
  async resetCashPin(
    @Input() input: ContractInput<typeof resetPinOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.devices.resetCashPin(input.params.driver_id, facts);
  }
}
