import type {
  BulkReplayResult,
  ConsumerList,
  OutboxRow,
  PlatformListOutbox200,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { findContext, findPlatformContext, getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Logger, Optional, Post } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import { CURSOR_CODEC, CursorCodec } from '../audit/cursor.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { ApiException } from '../errors/api-exception.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentPlatformOutbox, platformReplayStore } from '../platform/outbox.repository.js';
import type { OutboxStatus } from '../schema/outbox.js';
import { outboxStatuses } from '../schema/outbox.js';
import type { CrossTenantSource } from '../tenancy/cross-tenant.js';
import { CrossTenant, accountIdParam } from '../tenancy/cross-tenant.js';
import { kernelConsumers } from './account-suspended.consumer.js';
import { DomainEventConsumerRegistry } from './domain-event-consumers.js';
import type { OutboxSort } from './outbox-list.js';
import { outboxSorts } from './outbox-list.js';
import { replayAuditIdLimit, replayBulk, replayOne } from './outbox-replay.js';
import { OutboxRepository, tenantReplayStore } from './outbox.repository.js';
import { presentConsumers, presentOutboxPage, presentOutboxRow } from './outbox.presenter.js';
import type { OutboxQueues } from './queues.js';
import { OUTBOX_QUEUES } from './queues.js';

// The platform outbox operations (PLAT-8 plan 2.7; data §5.2, §5.3; integrations §4.5): list,
// read and replay outbox rows, list the internal consumers. Payloads only through the cross-tenant
// door of the row's account (`X-Support-Reason`, one audit row per call); without it rows are
// metadata only. Replays are audited (`platform.outbox_row.replayed`, `platform.outbox_rows
// .replayed`). `x-permission` (`platform.outbox.read`, `platform.outbox.replay`) is PLAT-10's.

const listOp = operationSchemas.platformListOutbox;
const getOp = operationSchemas.platformGetOutboxRow;
const replayOp = operationSchemas.platformReplayOutboxRow;
const bulkOp = operationSchemas.platformReplayDeadOutbox;
const consumersOp = operationSchemas.platformListConsumers;

/** Parked rows read per `platformListConsumers` call (a count beyond is a floor). */
export const parkedScanLimit = 10_000;

/** The door of an outbox row: its account, resolved from `:outbox_id` on the platform pool. */
const outboxRowDoor = (reason: 'header' | 'body'): CrossTenantSource => ({
  from: 'lookup',
  name: 'outbox_id',
  resource: 'outbox_row',
  reason,
  lookup: (id) => currentPlatformOutbox().accountOf(id),
});

/** The platform user and request of the call: the door's context, or the platform frame's. */
function caller(): { readonly userId: string; readonly requestId: string } {
  const door = findContext();
  const userId = door === undefined ? findPlatformContext()?.userId : door.userId;
  const requestId = door === undefined ? findPlatformContext()?.requestId : door.requestId;
  if (userId === undefined || userId === null || requestId === undefined) {
    throw new Error('No platform user on this request');
  }
  return { userId, requestId };
}

function statusesOf(value: string | undefined): OutboxStatus[] | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(',').map((part) => part.trim());
  const known = parts.every((part): part is OutboxStatus =>
    (outboxStatuses as readonly string[]).includes(part),
  );
  if (!known) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/query/status', code: 'invalid' }],
    });
  }
  return parts;
}

function sortOf(value: string | undefined): OutboxSort {
  const sort = value ?? '-created_at';
  if (!(outboxSorts as readonly string[]).includes(sort)) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/query/sort', code: 'invalid' }],
    });
  }
  return sort as OutboxSort;
}

/** PostgreSQL's text form of a time, as the cursor codec binds it. */
const cursorTime = (value: Date): string =>
  value.toISOString().replace('T', ' ').replace('Z', '+00');

@Controller('v1/platform')
export class PlatformOutboxController {
  private readonly cursors: CursorCodec;
  private readonly consumers = new DomainEventConsumerRegistry(kernelConsumers());

  constructor(
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
    @Optional() @Inject(OUTBOX_QUEUES) private readonly queues?: OutboxQueues | null,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
  }

  /** Replays and the consumer list need the queues (Redis); production requires `REDIS_URL`. */
  private requireQueues(): OutboxQueues {
    if (this.queues === undefined || this.queues === null) {
      new Logger('PlatformOutbox').warn('REDIS_URL is not set: outbox replays are refused');
      throw new ApiException('internal_error');
    }
    return this.queues;
  }

  /**
   * `platformListOutbox`: with `account_id`, that account's rows through the door (payload
   * included); without it, rows of every account as metadata only (the payload is never read).
   */
  @CrossTenant({ from: 'query', name: accountIdParam })
  @Get('outbox')
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<PlatformListOutbox200> {
    const { query } = input;
    // Every filter is checked before the cursor is decoded (lead review round 3), so a bad filter
    // answers 400 on its own pointer rather than as a cursor mismatch. The other filters are
    // checked by the contract schema in the pipe.
    const sort = sortOf(query.sort);
    const statuses = statusesOf(query.status);
    const binding = {
      operation: 'platformListOutbox',
      principal: `platform:${caller().userId}`,
      filters: {
        account_id: query.account_id,
        status: query.status,
        kind: query.kind,
        type: query.type,
        aggregate_id: query.aggregate_id,
        created_from: query.created_from,
        created_to: query.created_to,
      },
      sort,
    };
    const after =
      query.cursor === undefined ? undefined : this.cursors.decode(query.cursor, binding);
    const page = {
      filters: {
        statuses,
        kind: query.kind,
        type: query.type,
        aggregateId: query.aggregate_id,
        from: query.created_from,
        to: query.created_to,
      },
      sort,
      afterId: after?.id,
      limit: query.limit + 1,
    };
    const withEnvelope = query.account_id !== undefined;
    if (withEnvelope && getContext().accountId !== query.account_id) {
      // The door ran on the same parameter; a mismatch is a programming error, never a read.
      throw new Error('Door and query disagree');
    }
    const rows = withEnvelope
      ? await new OutboxRepository(getUnitOfWork()).page(page)
      : await currentPlatformOutbox().metadataPage(page);
    const kept = rows.slice(0, query.limit);
    const last = kept.at(-1);
    const next =
      rows.length > query.limit && last !== undefined
        ? this.cursors.encode({ occurredAt: cursorTime(last.createdAt), id: last.id }, binding)
        : null;
    return presentOutboxPage(kept, next, { withEnvelope });
  }

  /**
   * `platformGetOutboxRow`: through the door of the row's account, with its envelope; a
   * platform-only row (no account, no door) is metadata only.
   */
  @CrossTenant(outboxRowDoor('header'))
  @Get('outbox/:outbox_id')
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<OutboxRow> {
    const id = input.params.outbox_id;
    if (findContext() !== undefined) {
      const row = await new OutboxRepository(getUnitOfWork()).find(id);
      if (row === undefined) throw new ApiException('not_found');
      return presentOutboxRow(row, { withEnvelope: true });
    }
    const row = await currentPlatformOutbox().findMetadata(id);
    if (row === undefined) throw new ApiException('not_found');
    return presentOutboxRow(row, { withEnvelope: false });
  }

  /**
   * `platformReplayOutboxRow`: `dead` → `pending` through the door of the row's account (the
   * body's reason is the support reason), refused with `409 replay_not_allowed` otherwise; the
   * retained job is removed and the row's dead letters marked replayed; audited in the same
   * transaction.
   */
  @CrossTenant(outboxRowDoor('body'))
  @Post('outbox/:outbox_id/replay')
  @HttpCode(200)
  @Idempotent()
  @Operation(replayOp)
  async replay(@Input() input: ContractInput<typeof replayOp>): Promise<OutboxRow> {
    const queues = this.requireQueues();
    const id = input.params.outbox_id;
    const door = findContext() !== undefined;
    const store = door
      ? tenantReplayStore(getUnitOfWork())
      : platformReplayStore(currentPlatformOutbox());
    const result = await replayOne(store, queues, id);
    if (result === undefined) throw new ApiException('not_found');
    if (!result.replayed) {
      throw new ApiException('replay_not_allowed', {
        details: { current_status: result.current.status, reason: result.refusal },
      });
    }
    const { userId, requestId } = caller();
    await this.audit.record({
      actorType: 'platform_user',
      actorId: userId,
      accountId: result.before.accountId,
      targetType: 'outbox_row',
      targetId: id,
      action: 'platform.outbox_row.replayed',
      before: { status: result.before.status, attempts: result.before.attempts },
      after: { status: 'pending', attempts: 0, kind: result.before.kind, type: result.before.type },
      reason: input.body.reason,
      requestId,
    });
    const replayed = await store.find(id);
    if (replayed === undefined) throw new Error('The replayed row is gone');
    return presentOutboxRow(replayed, { withEnvelope: door });
  }

  /**
   * `platformReplayDeadOutbox`: the dead rows of one kind (and type, window), of one account
   * through its door or across accounts without it, in batches of 500; one audit row with the
   * counts.
   */
  @CrossTenant({ from: 'body', name: accountIdParam, reason: 'body' })
  @Post('outbox/replay-dead')
  @HttpCode(202)
  @Idempotent()
  @Operation(bulkOp)
  async replayDead(@Input() input: ContractInput<typeof bulkOp>): Promise<BulkReplayResult> {
    const queues = this.requireQueues();
    const { body } = input;
    // `account_id` is required (adversary M-1): the contract schema refuses its absence before the
    // handler runs; this guards the door having opened on it.
    if (findContext() === undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/account_id', code: 'required' }],
      });
    }
    if (getContext().accountId !== body.account_id) {
      throw new Error('Door and body disagree');
    }
    const filter = {
      kind: body.kind,
      type: body.type,
      from: body.created_from,
      to: body.created_to,
    };
    const counts = await replayBulk(tenantReplayStore(getUnitOfWork()), queues, filter);
    const { userId, requestId } = caller();
    await this.audit.record({
      actorType: 'platform_user',
      actorId: userId,
      accountId: body.account_id,
      targetType: 'outbox_kind',
      targetId: body.kind,
      action: 'platform.outbox_rows.replayed',
      after: {
        account_id: body.account_id,
        kind: body.kind,
        type: body.type ?? null,
        created_from: body.created_from ?? null,
        created_to: body.created_to ?? null,
        matched: counts.matched,
        replayed: counts.replayed,
        // The replayed rows, at most 500 (the first batch); `replayed` has the full count.
        outbox_ids: counts.ids.slice(0, replayAuditIdLimit),
      },
      reason: input.body.reason,
      requestId,
    });
    return { matched: counts.matched, replayed: counts.replayed };
  }

  /**
   * `platformListConsumers`: per internal consumer, the lag (oldest open event of its types
   * without its receipt), the events parked for it (open rows whose last outcome parked it and
   * whose job waits delayed in BullMQ) and its live dead letters. Counts only, no payload.
   */
  @Get('consumers')
  @Operation(consumersOp)
  async listConsumers(): Promise<ConsumerList> {
    const queues = this.requireQueues();
    const outbox = currentPlatformOutbox();
    const parkedRows = await outbox.parkedRows(parkedScanLimit);
    const delayed = await queues.delayedAmong(
      'internal_event',
      parkedRows.map((row) => row.id),
    );
    const parked = new Map<string, number>();
    for (const row of parkedRows) {
      if (!delayed.has(row.id)) continue;
      for (const name of row.consumers) parked.set(name, (parked.get(name) ?? 0) + 1);
    }
    const counts = [];
    for (const consumer of this.consumers.names()) {
      const stats = await outbox.consumerStats(consumer, this.consumers.typesOf(consumer));
      counts.push({ consumer, ...stats, parked: parked.get(consumer) ?? 0 });
    }
    return presentConsumers(counts);
  }
}
