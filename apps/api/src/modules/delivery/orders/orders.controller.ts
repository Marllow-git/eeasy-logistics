import type {
  ListOrderEvents200,
  ListOrders200,
  Order,
} from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  AuditSink,
  ContractInput,
  ListSorts,
  OrderStatus,
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
import type { Prelocated } from './order-locating.js';
import { OrderLocating, PreLocated } from './order-locating.js';
import { afterPickupStatuses } from './order-machine.js';
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
// `getOrder`, `listOrderEvents`, `updateOrder`, `transitionOrder`, `cancelOrder` (PLAT-10's guard;
// the `delivery` gate). The account
// is the token's; a site-scoped member (site staff, cashier) reads its own sites' orders only, and
// another site's order is `404` (README §4). Dispatcher writes carry `If-Match` (D-22).

const createOp = operationSchemas.createOrder;
const listOp = operationSchemas.listOrders;
const getOp = operationSchemas.getOrder;
const eventsOp = operationSchemas.listOrderEvents;
const updateOp = operationSchemas.updateOrder;
const transitionOp = operationSchemas.transitionOrder;
const cancelOp = operationSchemas.cancelOrder;

/** The dispatcher on the staff surface: the machine's `dispatcher`, the event's `user` (D-5). */
const dispatcherActor = () =>
  ({ role: 'dispatcher', type: 'user', id: getContext().userId }) as const;

/**
 * `transitionOrder`'s `accepted`: the dispatcher's accept of a `pending` order and the reschedule
 * of an `attempted` one. `assigned → accepted` (the dispatcher's unassign) stays in the machine for
 * DEL-6's assignment service, which closes the assignment with it (adversary round 1, ruling 3).
 */
const acceptFrom: ReadonlySet<OrderStatus> = new Set(['pending', 'attempted']);

/** A note of a transition: trimmed, blank is none (the contract bounds it at 1000). */
const noteOf = (note: string | undefined): string | null =>
  note === undefined || note.trim() === '' ? null : note.trim();

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
  private readonly transitions: OrderTransitions;
  private readonly accounts: OrderAccounts;
  private readonly cursors: CursorCodec;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    accounts: OrderAccounts,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    const coverage = new CoverageQuery();
    this.intake = new OrderIntake({
      coverage,
      accounts,
      sequences: new SequenceAllocator(),
      audit,
      outbox,
    });
    const transitions = new OrderTransitions({ coverage, audit, outbox });
    this.transitions = transitions;
    this.accounts = accounts;
    this.updates = new OrderUpdates({ coverage, accounts, audit, outbox, transitions });
    this.cursors = cursors ?? new CursorCodec(undefined);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @SiteScoped({ from: 'body', name: 'site_id' })
  @UseGuards(OrderLocating)
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
    @PreLocated() prelocated: Prelocated | undefined,
  ): Promise<Order> {
    const fields = newOrderFields(input.body);
    const created = await this.intake.create(getUnitOfWork(), {
      fields,
      source: 'manual',
      idempotencyKey: input.headers['Idempotency-Key'],
      facts,
      prelocated,
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

  /**
   * `updateOrder` (plan 2.8): the sent parts under the `If-Match` version; a sent address was
   * located by `OrderLocating` before the transaction opened.
   */
  @Patch(':order_id')
  @HttpCode(200)
  @Idempotent()
  @UseGuards(OrderLocating)
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
    @PreLocated() prelocated: Prelocated | undefined,
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
      prelocated,
    });
    return presentOrder(updated.order, updated.items);
  }

  /**
   * `transitionOrder` (plan 2.9): `accepted` (from `pending` with a zone, D-3; from `attempted`, the
   * reschedule without a slot; never from `assigned`, DEL-6's door) or `failed` (from `out_for_delivery`, `attempted`, and `picked_up`
   * for Q-6) with one of the account's reason codes.
   */
  @Post(':order_id/transitions')
  @HttpCode(200)
  @Idempotent()
  @Operation(transitionOp)
  async transition(
    @Input() input: ContractInput<typeof transitionOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Order> {
    const expectedVersion = ifMatchVersion(input.headers['If-Match']);
    const { body } = input;
    if (body.to_status === 'failed' || body.reason_code !== undefined) {
      await this.assertReasonCode(body.reason_code);
    }
    const uow = getUnitOfWork();
    const order = await this.transitions.apply(uow, input.params.order_id, {
      to: body.to_status,
      ...(body.to_status === 'accepted' ? { from: acceptFrom } : {}),
      actor: dispatcherActor(),
      expectedVersion,
      reasonCode: body.reason_code ?? null,
      note: noteOf(body.note),
      idempotencyKey: input.headers['Idempotency-Key'],
      facts,
    });
    return presentOrder(order, await new OrderItemsRepository(uow).of(order.id));
  }

  /**
   * `cancelOrder` (plan 2.9; Q-6): before pickup (`pending`, `accepted`, `offered`, `assigned`) the
   * order is `cancelled`; once a driver holds the parcel (`picked_up`, `out_for_delivery`,
   * `attempted`) it is `failed` with the reason and comes back through `returned`; a terminal or
   * failed order is `409 invalid_transition`.
   */
  @Post(':order_id/cancel')
  @HttpCode(200)
  @Idempotent()
  @Operation(cancelOp)
  async cancel(
    @Input() input: ContractInput<typeof cancelOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Order> {
    const expectedVersion = ifMatchVersion(input.headers['If-Match']);
    await this.assertReasonCode(input.body.reason_code);
    const uow = getUnitOfWork();
    const seen = await new OrdersRepository(uow).find(input.params.order_id);
    if (seen === undefined) throw new ApiException('not_found');
    // `apply` checks the arrow again under the row lock and the version.
    const to = afterPickupStatuses.has(seen.status) ? 'failed' : 'cancelled';
    const order = await this.transitions.apply(uow, seen.id, {
      to,
      actor: dispatcherActor(),
      expectedVersion,
      reasonCode: input.body.reason_code,
      note: noteOf(input.body.note),
      idempotencyKey: input.headers['Idempotency-Key'],
      facts,
    });
    return presentOrder(order, await new OrderItemsRepository(uow).of(order.id));
  }

  /** `400 validation_failed` at `/body/reason_code` unless it is one of the account's active codes. */
  private async assertReasonCode(code: string | undefined): Promise<void> {
    const account = await this.accounts.current();
    if (code === undefined || !account.reasonCodes.includes(code)) {
      throw new ApiException('validation_failed', {
        fields: [
          { pointer: '/body/reason_code', code: code === undefined ? 'required' : 'invalid' },
        ],
      });
    }
  }
}
