import { describe, expect, it } from 'vitest';
import type { UncheckedPushTicket } from '../../modules/kernel/platform/push-tickets.repository.js';
import { checksFor, noReceiptAfterMs } from './push-receipts.js';

// INT-4 plan 2.4, 2.10: what a receipts answer means for the tickets asked about.

const now = new Date('2026-11-02T12:00:00Z');
const ticket = (n: number, ageMs: number): UncheckedPushTicket => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  accountId: '00000000-0000-4000-8000-0000000000a1',
  deviceId: `00000000-0000-4000-8000-0000000000d${n}`,
  ticketId: `ticket-${n}`,
  sentAt: new Date(now.getTime() - ageMs),
});

describe('checksFor', () => {
  it('maps ok and error receipts, leaves a young ticket without one, and marks an old one no_receipt', () => {
    const tickets = [
      ticket(1, 20 * 60_000),
      ticket(2, 20 * 60_000),
      ticket(3, 20 * 60_000),
      ticket(4, noReceiptAfterMs),
    ];
    const receipts = new Map([
      ['ticket-1', { status: 'ok' as const }],
      ['ticket-2', { status: 'error' as const, error: 'DeviceNotRegistered' }],
    ]);
    expect(checksFor(tickets, receipts, now)).toEqual([
      { id: tickets[0]?.id, status: 'ok', error: null },
      { id: tickets[1]?.id, status: 'error', error: 'DeviceNotRegistered' },
      { id: tickets[3]?.id, status: 'error', error: 'no_receipt' },
    ]);
  });

  it('prefers a late receipt over no_receipt', () => {
    const old = ticket(5, noReceiptAfterMs + 60_000);
    expect(checksFor([old], new Map([['ticket-5', { status: 'ok' as const }]]), now)).toEqual([
      { id: old.id, status: 'ok', error: null },
    ]);
  });
});
