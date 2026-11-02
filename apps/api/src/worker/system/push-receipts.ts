import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { Redis } from 'ioredis';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import { ProviderFailure } from '../../modules/kernel/outbox/provider-failure.js';
import type {
  PushTicketCheck,
  UncheckedPushTicket,
} from '../../modules/kernel/platform/push-tickets.repository.js';
import { pushTicketsOn } from '../../modules/kernel/platform/push-tickets.repository.js';
import type { PushTokenInvalidations } from '../../modules/kernel/push/invalidations.js';
import type { PushSender } from '../../modules/kernel/push/push-sender.js';
import { deviceNotRegistered, maxReceiptIds } from '../../modules/kernel/push/push-sender.js';
import { getMetrics } from '../../modules/kernel/telemetry/metrics.js';

// The push receipts job (INT-4 plan 2.4; integrations §2.5: receipt polling is a scheduled worker
// job, not an outbox row). Every 5 minutes, under the Redis lock `elx:lock:push-receipts`:
// - up to 1,000 unchecked tickets older than 15 minutes are checked with one `receipts` call; each
//   receipt writes `status`, `error` and `checked_at`; a ticket still without a receipt 24 hours
//   after it was sent is `error` `no_receipt` (Expo clears receipts after 24 hours);
// - every `DeviceNotRegistered` goes to the token invalidation registry, once (the ticket is marked
//   first, so a later run never sees it again);
// - `InvalidCredentials` and `MismatchSenderId` (our push credentials) log one warning per run;
// - tickets older than 7 days are deleted, with one audit row of counts when any were.
// The job reads Expo and writes only our own tables; it never touches the outbox.

export const pushReceiptsLockKey = 'elx:lock:push-receipts';
export const pushReceiptsIntervalMs = 5 * 60 * 1000;
/** The lock outlives one run and expires before the next. */
export const pushReceiptsLockTtlMs = 4 * 60 * 1000;
/** Expo: receipts are available within 15 minutes. */
export const receiptDelayMs = 15 * 60 * 1000;
/** Expo clears receipts after 24 hours. */
export const noReceiptAfterMs = 24 * 60 * 60 * 1000;
/** Plan §7 question 2 (default): tickets are kept 7 days. */
export const ticketRetentionMs = 7 * 24 * 60 * 60 * 1000;
export const pushTicketsPurgedAction = 'core.push_tickets.purged';

/** Receipt errors that mean our push credentials are wrong, not the device. */
const credentialErrors: ReadonlySet<string> = new Set(['InvalidCredentials', 'MismatchSenderId']);

export interface PushReceiptsCounts {
  readonly checked: number;
  readonly ok: number;
  readonly error: number;
  readonly noReceipt: number;
  readonly invalidated: number;
  readonly purged: number;
}

export type PushReceiptsRun =
  { readonly ran: true; readonly counts: PushReceiptsCounts } | { readonly ran: false };

export interface PushReceiptsDependencies {
  readonly db: PlatformDatabase;
  readonly redis: Pick<Redis, 'set'>;
  readonly sender: PushSender;
  readonly invalidations: PushTokenInvalidations;
  readonly audit: Pick<AuditSink, 'record'>;
  readonly logger: { log(message: string): void; warn(message: string): void };
  readonly now?: () => Date;
  readonly lockKey?: string;
}

/** What one receipts answer means for the tickets asked about. */
export function checksFor(
  tickets: readonly UncheckedPushTicket[],
  receipts: ReadonlyMap<string, { status: 'ok' } | { status: 'error'; error: string }>,
  now: Date,
): PushTicketCheck[] {
  const checks: PushTicketCheck[] = [];
  for (const ticket of tickets) {
    const receipt = receipts.get(ticket.ticketId);
    if (receipt !== undefined) {
      checks.push(
        receipt.status === 'ok'
          ? { id: ticket.id, status: 'ok', error: null }
          : { id: ticket.id, status: 'error', error: receipt.error },
      );
    } else if (now.getTime() - ticket.sentAt.getTime() >= noReceiptAfterMs) {
      checks.push({ id: ticket.id, status: 'error', error: 'no_receipt' });
    }
  }
  return checks;
}

/** One scheduled run: takes the lock (`SET NX PX`, 4 min), checks, invalidates, purges. */
export async function runPushReceipts(deps: PushReceiptsDependencies): Promise<PushReceiptsRun> {
  const lock = deps.lockKey ?? pushReceiptsLockKey;
  const acquired = await deps.redis.set(lock, randomUUID(), 'PX', pushReceiptsLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  const now = deps.now?.() ?? new Date();
  const tickets = pushTicketsOn(deps.db);
  const metrics = getMetrics();

  const due = await tickets((repo) =>
    repo.unchecked(new Date(now.getTime() - receiptDelayMs), maxReceiptIds),
  );
  let checks: PushTicketCheck[] = [];
  if (due.length > 0) {
    try {
      const receipts = await deps.sender.receipts(due.map((ticket) => ticket.ticketId));
      checks = checksFor(
        due,
        new Map(receipts.map((receipt) => [receipt.id, receipt] as const)),
        now,
      );
    } catch (error) {
      // The push service is unreachable or refused us: the tickets wait for the next run.
      const reason = error instanceof ProviderFailure ? error.reason : 'error';
      const status = error instanceof ProviderFailure ? String(error.status ?? 'n/a') : 'n/a';
      deps.logger.warn(`Push receipts not checked: ${reason} status=${status}`);
    }
  }
  if (checks.length > 0) await tickets((repo) => repo.markChecked(checks, now));

  const byId = new Map(due.map((ticket) => [ticket.id, ticket] as const));
  const counts = { checked: checks.length, ok: 0, error: 0, noReceipt: 0, invalidated: 0 };
  const credentials = new Map<string, number>();
  for (const check of checks) {
    if (check.status === 'ok') counts.ok += 1;
    else if (check.error === 'no_receipt') counts.noReceipt += 1;
    else counts.error += 1;
    if (check.error !== null && credentialErrors.has(check.error)) {
      credentials.set(check.error, (credentials.get(check.error) ?? 0) + 1);
    }
  }
  metrics.add('push_receipts_total', counts.ok, { status: 'ok' });
  metrics.add('push_receipts_total', counts.error, { status: 'error' });
  metrics.add('push_receipts_total', counts.noReceipt, { status: 'no_receipt' });
  for (const [name, n] of credentials) {
    deps.logger.warn(`Push receipts report ${name} for ${n} tickets: check the push credentials`);
  }
  for (const check of checks) {
    const ticket = byId.get(check.id);
    if (ticket === undefined || check.error !== deviceNotRegistered) continue;
    await deps.invalidations.invalidate({
      accountId: ticket.accountId,
      deviceId: ticket.deviceId,
      reason: 'device_not_registered',
    });
    counts.invalidated += 1;
  }

  const runId = randomUUID();
  const purged = await tickets(async (repo) => {
    const deleted = await repo.purgeBefore(new Date(now.getTime() - ticketRetentionMs));
    if (deleted > 0) {
      await deps.audit.record({
        actorType: 'system',
        actorId: null,
        accountId: null,
        targetType: 'push_tickets',
        targetId: runId,
        action: pushTicketsPurgedAction,
        after: { deleted, retention_days: 7 },
        requestId: runId,
      });
    }
    return deleted;
  });
  return { ran: true, counts: { ...counts, purged } };
}
