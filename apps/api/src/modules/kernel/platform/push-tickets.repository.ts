import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import {
  PlatformRepository,
  withPlatformAccountTransaction,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import { and, asc, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { NewPushTicket, PushTicketWriter } from '../push/push.handler.js';
import { corePushTickets } from '../schema/push-tickets.js';

// `core_push_tickets` on the platform pool (INT-4 plan 2.4): the worker's `push` handler writes the
// accepted tickets of a row in one transaction with the row's account set (the other handlers'
// way), naming the account on every row; the receipts job reads and marks tickets across accounts
// and purges old ones, as the platform's own system work.

export function pushTicketWriter(db: PlatformDatabase): PushTicketWriter {
  return {
    insertTickets: async (accountId, tickets: readonly NewPushTicket[]) => {
      if (tickets.length === 0) return;
      await withPlatformAccountTransaction(db, accountId, async (tx) => {
        await tx.insert(corePushTickets).values(
          tickets.map((ticket) => ({
            id: ticket.id,
            accountId,
            outboxId: ticket.outboxId,
            deviceId: ticket.deviceId,
            ticketId: ticket.ticketId,
          })),
        );
      });
    },
  };
}

/** A ticket the receipts job checks. */
export interface UncheckedPushTicket {
  readonly id: string;
  readonly accountId: string;
  readonly deviceId: string;
  readonly ticketId: string;
  readonly sentAt: Date;
}

/** What a check found for one ticket. */
export interface PushTicketCheck {
  readonly id: string;
  readonly status: 'ok' | 'error';
  /** The receipt's error name, or `no_receipt`; null when ok. */
  readonly error: string | null;
}

export class PushTicketsRepository extends PlatformRepository<typeof corePushTickets> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, corePushTickets);
  }

  /** Unchecked tickets sent before `sentBefore`, oldest first (the partial index). */
  unchecked(sentBefore: Date, limit: number): Promise<UncheckedPushTicket[]> {
    return this.unscoped()
      .select({
        id: corePushTickets.id,
        accountId: corePushTickets.accountId,
        deviceId: corePushTickets.deviceId,
        ticketId: corePushTickets.ticketId,
        sentAt: corePushTickets.sentAt,
      })
      .from(corePushTickets)
      .where(and(isNull(corePushTickets.checkedAt), lt(corePushTickets.sentAt, sentBefore)))
      .orderBy(asc(corePushTickets.sentAt))
      .limit(limit);
  }

  /** Writes each check, only on a ticket still unchecked; returns how many changed. */
  async markChecked(checks: readonly PushTicketCheck[], at: Date): Promise<number> {
    let changed = 0;
    for (const status of ['ok', 'error'] as const) {
      const byError = new Map<string | null, string[]>();
      for (const check of checks.filter((c) => c.status === status)) {
        byError.set(check.error, [...(byError.get(check.error) ?? []), check.id]);
      }
      for (const [error, ids] of byError) {
        const rows = await this.unscoped()
          .update(corePushTickets)
          .set({ status, error, checkedAt: at, updatedAt: at })
          .where(and(inArray(corePushTickets.id, ids), isNull(corePushTickets.checkedAt)))
          .returning({ id: corePushTickets.id });
        changed += rows.length;
      }
    }
    return changed;
  }

  /** Deletes tickets sent before `cutoff` (plan 2.4: kept 7 days); returns how many. */
  async purgeBefore(cutoff: Date): Promise<number> {
    const rows = await this.unscoped()
      .delete(corePushTickets)
      .where(lt(corePushTickets.sentAt, sql`${cutoff.toISOString()}::timestamptz`))
      .returning({ id: corePushTickets.id });
    return rows.length;
  }
}

/** One platform unit of work over the tickets (the receipts job's transactions). */
export function pushTicketsOn(db: PlatformDatabase) {
  return <T>(fn: (tickets: PushTicketsRepository, uow: PlatformUnitOfWork) => Promise<T>) =>
    withPlatformUnitOfWork(db, (uow) => fn(new PushTicketsRepository(uow), uow));
}
