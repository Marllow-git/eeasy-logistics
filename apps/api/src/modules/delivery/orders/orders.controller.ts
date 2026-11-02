import type { Order } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getUnitOfWork } from '@eeasy-logistics/db';
import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type {
  AuditSink,
  ContractInput,
  GeocoderService,
  RequestFacts,
} from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  Feature,
  GEOCODER,
  Idempotent,
  Input,
  Operation,
  OrderAccounts,
  OutboxWriter,
  SequenceAllocator,
  SiteScoped,
} from '../../kernel/public/index.js';
import { CoverageQuery } from '../zones/coverage-query.js';
import { OrderIntake } from './order-intake.js';
import { newOrderFields } from './order-input.js';
import { presentOrder } from './orders.presenter.js';

// The staff surface's `orders` tag (DEL-2 plan 2.3; leg 2 adds the reads, the update and the
// transitions): `createOrder` (`delivery.orders.create`, PLAT-10's guard). The account is the
// token's; a site-scoped member creates for their own sites only (`404` otherwise, README §4).

const createOp = operationSchemas.createOrder;

@Feature('delivery')
@Controller('v1/staff/orders')
export class OrdersController {
  private readonly intake: OrderIntake;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Inject(GEOCODER) geocoder: GeocoderService,
    outbox: OutboxWriter,
    accounts: OrderAccounts,
  ) {
    this.intake = new OrderIntake({
      geocoder,
      coverage: new CoverageQuery(),
      accounts,
      sequences: new SequenceAllocator(),
      audit,
      outbox,
    });
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @SiteScoped({ from: 'body', name: 'site_id' })
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Order> {
    const fields = newOrderFields(input.body);
    const created = await this.intake.create(getUnitOfWork(), {
      fields,
      source: 'manual',
      idempotencyKey: input.headers['Idempotency-Key'],
      facts,
    });
    return presentOrder(created.order, created.items);
  }
}
