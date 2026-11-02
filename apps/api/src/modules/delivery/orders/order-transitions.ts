import type { UnitOfWork } from '@eeasy-logistics/db';
import { getContext, uuidv7 } from '@eeasy-logistics/db';
import type {
  AuditSink,
  DomainEventType,
  OrderActorType,
  OrderStatus,
  OutboxWriter,
} from '../../kernel/public/index.js';
import { ApiException, assertVersion } from '../../kernel/public/index.js';
import type { AuditFacts } from './order-intake.js';
import type { OrderActor } from './order-machine.js';
import { isTerminal, transition } from './order-machine.js';
import type { LatLng, OrderRow } from './orders.repository.js';
import { OrderEventsRepository, OrdersRepository } from './orders.repository.js';

// The one write path of an order's status (DEL-2 plan 2.9, 2.10; domain model §3.13, D-3, D-5,
// D-8, D-15, D-22). Every arrow goes through `apply`: the row under `FOR UPDATE`, the version the
// caller read (when it sent one), the machine's verdict for the actor, D-3 on `accepted`, then the
// status, `version + 1`, `terminal_at`, the event, the audit row (when the caller has request
// facts) and the outbox row, in the caller's unit of work. DEL-6's offers and DEL-7's driver
// events call it with their own actor and add their checks (the assignee, D-16, D-23) before it.
// Neither the audit row nor the outbox payload carries recipient data (data §10).

/** Who takes the arrow: the machine's role, the event's actor type and id. */
export interface TransitionActor {
  readonly role: OrderActor;
  readonly type: OrderActorType;
  readonly id: string | null;
}

export interface TransitionCommand {
  readonly to: OrderStatus;
  readonly actor: TransitionActor;
  /**
   * The statuses this door may move from, checked under the row lock on top of the machine (a
   * door narrower than the actor's arrows: `transitionOrder`'s `accepted`, adversary round 1).
   */
  readonly from?: ReadonlySet<OrderStatus> | undefined;
  /** The `If-Match` version; a different current version is `409 version_conflict` (D-22). */
  readonly expectedVersion?: number | undefined;
  readonly reasonCode?: string | null | undefined;
  readonly note?: string | null | undefined;
  /** The request's or the driver event's key (D-15); null for a system arrow. */
  readonly idempotencyKey?: string | null | undefined;
  readonly clientTs?: Date | null | undefined;
  readonly point?: LatLng | null | undefined;
  readonly deviceId?: string | null | undefined;
  /** The request facts of the audit row; without them no audit row is written. */
  readonly facts?: AuditFacts | undefined;
}

/** The statuses that leave no driver on the order: its current assignment is cleared. */
const releasesAssignment: ReadonlySet<OrderStatus> = new Set(['cancelled', 'failed', 'accepted']);

/** The outbox type of an arrow into `to` (catalogue §6.3: one type per status). */
export const statusEventType = (to: OrderStatus): DomainEventType =>
  `delivery.order.${to}` as DomainEventType;

export interface TransitionDependencies {
  readonly audit: AuditSink;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
}

export class OrderTransitions {
  constructor(private readonly deps: TransitionDependencies) {}

  /**
   * Moves the order to `command.to` or refuses: `404` for an order the context cannot see,
   * `409 version_conflict`, `409 invalid_transition` (terminal, no arrow, wrong actor) with
   * `current_status` and `version`, `422 outside_coverage` for an `accepted` order without a zone
   * (`details.pending_reason` says why: no zone covers the point, or there is no point).
   */
  async apply(uow: UnitOfWork, orderId: string, command: TransitionCommand): Promise<OrderRow> {
    const orders = new OrdersRepository(uow);
    const current = await orders.find(orderId, { forUpdate: true });
    if (current === undefined) throw new ApiException('not_found');
    if (command.expectedVersion !== undefined) assertVersion(current, command.expectedVersion);
    const verdict = transition(current.status, command.to, command.actor.role);
    if (!verdict.allowed || (command.from !== undefined && !command.from.has(current.status))) {
      throw new ApiException('invalid_transition', {
        details: { current_status: current.status, version: current.version },
      });
    }
    if (command.to === 'accepted' && current.zoneId === null) {
      throw new ApiException('outside_coverage', {
        details: { pending_reason: current.pendingReason ?? 'outside_coverage' },
      });
    }

    const order = await orders.update(current.id, {
      status: command.to,
      // The reason explains a `pending` order only (D-3).
      pendingReason: command.to === 'pending' ? current.pendingReason : null,
      // No driver holds the order any more (adversary round 1, ruling 4): DEL-6 closes the
      // assignment row and tells the driver from the `cancelled` and `failed` events.
      ...(releasesAssignment.has(command.to) ? { currentAssignmentId: null } : {}),
      version: current.version + 1,
      ...(isTerminal(command.to) ? { terminalAt: new Date() } : {}),
    });
    const reasonCode = command.reasonCode ?? null;
    await new OrderEventsRepository(uow).append(
      {
        id: uuidv7(),
        orderId: order.id,
        type: 'transition',
        fromStatus: current.status,
        toStatus: order.status,
        actorType: command.actor.type,
        actorId: command.actor.id,
        deviceId: command.deviceId ?? null,
        clientTs: command.clientTs ?? null,
        idempotencyKey: command.idempotencyKey ?? null,
        reasonCode,
        note: command.note ?? null,
      },
      command.point ?? null,
    );
    if (command.facts !== undefined) {
      await this.deps.audit.record({
        actorType: command.actor.type,
        actorId: command.actor.id,
        accountId: getContext().accountId,
        targetType: 'order',
        targetId: order.id,
        action: 'delivery.order.transitioned',
        before: { status: current.status, version: current.version },
        after: { status: order.status, version: order.version, reason_code: reasonCode },
        requestId: command.facts.requestId,
        clientRequestId: command.facts.clientRequestId,
        ip: command.facts.ip,
        userAgent: command.facts.userAgent,
      });
    }
    await this.deps.outbox.enqueue(uow, {
      type: statusEventType(order.status),
      version: 1,
      aggregate: { type: 'order', id: order.id, version: order.version },
      kind: 'internal_event',
      payload: {
        order_id: order.id,
        number: order.number,
        from_status: current.status,
        to_status: order.status,
        reason_code: reasonCode,
        actor_type: command.actor.type,
        site_id: order.siteId,
        zone_id: order.zoneId,
      },
    });
    return order;
  }
}

/** Reads an order for a later arrow's own checks (plan 2.10: DEL-6, DEL-7). */
export const OrderReader = Object.freeze({
  byId(uow: UnitOfWork, id: string): Promise<OrderRow | undefined> {
    return new OrdersRepository(uow).find(id);
  },
});
