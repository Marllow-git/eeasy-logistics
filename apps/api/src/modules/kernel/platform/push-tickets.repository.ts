import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformAccountTransaction } from '@eeasy-logistics/db/platform';
import type { NewPushTicket, PushTicketWriter } from '../push/push.handler.js';
import { corePushTickets } from '../schema/push-tickets.js';

// `core_push_tickets` on the platform pool (INT-4 plan 2.4): the worker's `push` handler writes the
// accepted tickets of a row in one transaction with the row's account set (the other handlers'
// way), naming the account on every row.

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
