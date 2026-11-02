import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../kernel/public/index.js';
import { orderStatuses } from '../../kernel/public/index.js';
import { isTerminal, nextStatuses, orderActors, transition } from './order-machine.js';

// The full table of domain model §3.13 (DEL-2 plan 2.6): every pair of statuses for every actor.
// The legal arrows are written out here independently of the module's data, from the diagram and
// the actor table; every other (from, to, actor) must be refused with the right reason.

const legal = new Set([
  'pending>accepted:dispatcher',
  'pending>accepted:system',
  'pending>cancelled:dispatcher',
  'accepted>offered:dispatcher',
  'accepted>offered:system',
  'accepted>assigned:dispatcher',
  'accepted>cancelled:dispatcher',
  'offered>assigned:driver',
  'offered>accepted:system',
  'offered>cancelled:dispatcher',
  'assigned>picked_up:driver',
  'assigned>accepted:dispatcher',
  'assigned>cancelled:dispatcher',
  'picked_up>out_for_delivery:driver',
  // Plan 2.9, Q-6: a cancel after pickup goes through failed (§3.13's closing note).
  'picked_up>failed:dispatcher',
  'out_for_delivery>delivered:driver',
  'out_for_delivery>attempted:driver',
  'out_for_delivery>failed:dispatcher',
  'attempted>out_for_delivery:driver',
  'attempted>accepted:dispatcher',
  'attempted>failed:system',
  'attempted>failed:dispatcher',
  'failed>returned:site_staff',
]);

/** A pair any actor may take. */
const arrowExists = (from: OrderStatus, to: OrderStatus) =>
  orderActors.some((actor) => legal.has(`${from}>${to}:${actor}`));

describe('the order state machine (§3.13)', () => {
  it('has eleven statuses, three terminal', () => {
    expect(orderStatuses).toHaveLength(11);
    expect(orderStatuses.filter((status) => isTerminal(status))).toEqual([
      'delivered',
      'returned',
      'cancelled',
    ]);
  });

  it('answers every (from, to, actor) of the table', () => {
    let checked = 0;
    for (const from of orderStatuses) {
      for (const to of orderStatuses) {
        for (const actor of orderActors) {
          const verdict = transition(from, to, actor);
          const key = `${from}>${to}:${actor}`;
          if (legal.has(key)) {
            expect(verdict, key).toEqual({ allowed: true });
          } else if (isTerminal(from)) {
            expect(verdict, key).toEqual({ allowed: false, reason: 'terminal' });
          } else if (arrowExists(from, to)) {
            expect(verdict, key).toEqual({ allowed: false, reason: 'wrong_actor' });
          } else {
            expect(verdict, key).toEqual({ allowed: false, reason: 'no_arrow' });
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(11 * 11 * 4);
  });

  it('lists the next statuses per actor', () => {
    expect(nextStatuses('pending', 'dispatcher')).toEqual(['accepted', 'cancelled']);
    expect(nextStatuses('pending', 'driver')).toEqual([]);
    expect(nextStatuses('attempted', 'dispatcher')).toEqual(['accepted', 'failed']);
    expect(nextStatuses('failed', 'site_staff')).toEqual(['returned']);
    expect(nextStatuses('delivered', 'dispatcher')).toEqual([]);
  });
});
