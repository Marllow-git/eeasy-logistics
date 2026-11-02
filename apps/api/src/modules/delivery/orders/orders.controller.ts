import type {
  ListOrderEvents200,
  ListOrders200,
  Order,
} from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type {
  AuditSink,
  ContractInput,
  GeocoderService,
  ListSorts,
  RequestFacts,
} from '../../kernel/public/index.js';
import {
  AUDIT_SINK,
  AuthRequest,
  CURSOR_CODEC,
  CursorCodec,
  entityTag,
  enumListFilter,
  Feature,
  GEOCODER,
  Idempotent,
  ifMatchVersion,
  Input,
  Operation,
  OrderAccounts,
  orderStatuses,
  OutboxWriter,
  parseDisplayNumber,
  planListPage,
  presentPage,
  sentBodyFields,
  SequenceAllocator,
  SiteScoped,
  textQuery,
  ApiException,
} from '../../kernel/public/index.js';
import { CoverageQuery } from '../zones/coverage-query.js';
import { OrderIntake } from './order-intake.js';
import { newOrderFields, orderPatchFields } from './order-input.js';
import { OrderTransitions } from './order-transitions.js';
import { OrderUpdates } from './order-updates.js';
import { presentOrder, presentOrderEvent } from './orders.presenter.js';
import type { ListedOrder, ListedOrderEvent, OrderSortField } from './orders.repository.js';
import {
  OrderEventsRepository,
  OrderItemsRepository,
  OrdersRepository,
} from './orders.repository.js';

// The staff surface's `orders` tag (DEL-2 plan 2.3, 2.7 to 2.9): `createOrder`, `listOrders`,
// `getOrder`, `listOrderEvents`, `updateOrder` (PLAT-10's guard; the `delivery` gate). The account
// is the token's; a site-scoped member (site staff, cashier) reads its own sites' orders only, and
// another site's order is `404` (README §4). Dispatcher writes carry `If-Match` (D-22).

const createOp = operationSchemas.createOrder;
const listOp = operationSchemas.listOrders;
const getOp = operationSchemas.getOrder;
const eventsOp = operationSchemas.listOrderEvents;
const updateOp = operationSchemas.updateOrder;

const orderSorts: ListSorts<OrderSortField> = {
  fields: { created_at: 'timestamp', updated_at: 'timestamp', number: 'text', status: 'text' },
  default: '-created_at',
};

// The timeline reads oldest first (plan 2.7: by `server_ts`, then `id`).
const eventSorts: ListSorts<'server_ts'> = {
  fields: { server_ts: 'timestamp' },
  default: 'server_ts',
};

@Feature('delivery')
@Controller('v1/staff/orders')
export class OrdersController {
  private readonly intake: OrderIntake;
  private readonly updates: OrderUpdates;
  private readonly cursors: CursorCodec;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Inject(GEOCODER) geocoder: GeocoderService,
    outbox: OutboxWriter,
    accounts: OrderAccounts,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    const coverage = new CoverageQuery();
    this.intake = new OrderIntake({
      geocoder,
      coverage,
      accounts,
      sequences: new SequenceAllocator(),
      audit,
      outbox,
    });
    const transitions = new OrderTransitions({ audit, outbox });
    this.updates = new OrderUpdates({ geocoder, coverage, accounts, audit, transitions });
    this.cursors = cursors ?? new CursorCodec(undefined);
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

  /**
   * `listOrders` (plan 2.7): every filter, the site scope and the keyset in SQL. `driver_id` needs
   * DEL-6's assignments, so it answers an empty page until then. List items carry no `items`.
   */
  @Get()
  @SiteScoped({ from: 'query', name: 'site_id' })
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListOrders200> {
    const { query } = input;
    // Filters are checked before the cursor, so a bad one answers on its own pointer.
    const statuses = enumListFilter(query.status, orderStatuses, '/query/status');
    let number: number | undefined;
    if (query.number !== undefined) {
      number = parseDisplayNumber('delivery_order', query.number);
      if (number === undefined) {
        throw new ApiException('validation_failed', {
          fields: [{ pointer: '/query/number', code: 'invalid' }],
        });
      }
    }
    const q = textQuery(query.q);
    const plan = planListPage(this.cursors, {
      operation: 'listOrders',
      reader: `account:${getContext().accountId}`,
      filters: {
        status: query.status,
        site_id: query.site_id,
        driver_id: query.driver_id,
        created_from: query.created_from,
        created_to: query.created_to,
        updated_from: query.updated_from,
        kind: query.kind,
        number: query.number,
        source_ref: query.source_ref,
        zone_id: query.zone_id,
        q,
      },
      sorts: orderSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    if (query.driver_id !== undefined) return { data: [], next_cursor: null };
    const rows = await new OrdersRepository(getUnitOfWork()).page(
      {
        statuses,
        siteId: query.site_id?.toLowerCase(),
        zoneId: query.zone_id?.toLowerCase(),
        kind: query.kind,
        number,
        sourceRef: query.source_ref,
        createdFrom: query.created_from,
        createdTo: query.created_to,
        updatedFrom: query.updated_from,
        q,
      },
      plan,
      (text) => parseDisplayNumber('delivery_order', text),
    );
    const page = plan.page(rows, (row: ListedOrder) => ({ value: row.sortKey, id: row.id }));
    return presentPage(page, (row) => presentOrder(row));
  }

  /** `getOrder`: the order with its items; `ETag` carries the version `If-Match` sends back. */
  @Get(':order_id')
  @Operation(getOp)
  async get(
    @Input() input: ContractInput<typeof getOp>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Order> {
    const uow = getUnitOfWork();
    const order = await new OrdersRepository(uow).find(input.params.order_id);
    if (order === undefined) throw new ApiException('not_found');
    response.setHeader('ETag', entityTag(order.version));
    return presentOrder(order, await new OrderItemsRepository(uow).of(order.id));
  }

  /** `listOrderEvents`: the order's timeline, oldest first by default. */
  @Get(':order_id/events')
  @Operation(eventsOp)
  async events(@Input() input: ContractInput<typeof eventsOp>): Promise<ListOrderEvents200> {
    const { params, query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'listOrderEvents',
      reader: `account:${getContext().accountId}`,
      filters: { order_id: params.order_id.toLowerCase() },
      sorts: eventSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const uow = getUnitOfWork();
    const order = await new OrdersRepository(uow).find(params.order_id);
    if (order === undefined) throw new ApiException('not_found');
    const rows = await new OrderEventsRepository(uow).page(order.id, plan);
    const page = plan.page(rows, (row: ListedOrderEvent) => ({ value: row.sortKey, id: row.id }));
    return presentPage(page, presentOrderEvent);
  }

  /** `updateOrder` (plan 2.8): the sent parts under the `If-Match` version. */
  @Patch(':order_id')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Order> {
    const expectedVersion = ifMatchVersion(input.headers['If-Match']);
    const uow = getUnitOfWork();
    const seen = await new OrdersRepository(uow).find(input.params.order_id);
    if (seen === undefined) throw new ApiException('not_found');
    const patch = orderPatchFields(input.body, sentBodyFields(input), seen.kind);
    const updated = await this.updates.update(uow, {
      orderId: seen.id,
      expectedVersion,
      patch,
      idempotencyKey: input.headers['Idempotency-Key'],
      facts,
    });
    return presentOrder(updated.order, updated.items);
  }
}
