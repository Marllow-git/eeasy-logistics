import type { ListZones200, Zone } from '@eeasy-logistics/contracts/staff/schemas';
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
  textQuery,
  Feature,
} from '../../kernel/public/index.js';
import type { ZoneSortField } from './zones.repository.js';
import { presentZone } from './zones.presenter.js';
import { ZonesService } from './zones.service.js';

// The staff surface's `zones` tag (DEL-1 plan 2.2, 2.3): `listZones`, `getZone`
// (`delivery.zones.read`), `createZone`, `updateZone` (`delivery.zones.manage`), enforced by
// PLAT-10's guard. The account is the token's; another account's zone is `404`.

const listOp = operationSchemas.listZones;
const createOp = operationSchemas.createZone;
const getOp = operationSchemas.getZone;
const updateOp = operationSchemas.updateZone;

const zoneSorts: ListSorts<ZoneSortField> = {
  fields: { created_at: 'timestamp', name_ar: 'text', name_en: 'text' },
  default: '-created_at',
};

// The `delivery` module's feature gate (DEL-1 plan 2.9; ADR-0006): `403 feature_not_enabled`
// for an account the module is not visible to (K-6).
@Feature('delivery')
@Controller('v1/staff/zones')
export class ZonesController {
  private readonly cursors: CursorCodec;
  private readonly zones: ZonesService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.zones = new ZonesService({ audit });
  }

  /** A page of zones without their boundaries (plan 2.3: `getZone` carries the boundary). */
  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListZones200> {
    const { query } = input;
    const q = textQuery(query.q);
    const plan = planListPage(this.cursors, {
      operation: 'listZones',
      reader: `account:${getContext().accountId}`,
      filters: { active: query.active === undefined ? undefined : String(query.active), q },
      sorts: zoneSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.zones.list({ plan, active: query.active, q });
    return presentPage(page, presentZone);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Zone> {
    return presentZone(await this.zones.create(input.body, facts));
  }

  @Get(':zone_id')
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<Zone> {
    return presentZone(await this.zones.get(input.params.zone_id));
  }

  /** A PATCH of the sent fields (plan 2.3); `source` is not changed by an update. */
  @Patch(':zone_id')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Zone> {
    return presentZone(await this.zones.update(input.params.zone_id, input.body, facts));
  }
}
