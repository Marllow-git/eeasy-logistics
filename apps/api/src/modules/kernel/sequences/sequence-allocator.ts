import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { sql } from 'drizzle-orm';
import type { SequenceName } from '../schema/sequences.js';
import { coreSequences } from '../schema/sequences.js';

// `SequenceAllocator` (DEL-2 plan 2.2; domain model §1.1: kernel → all, sync, in the caller's
// transaction; D-2; data §7). The next number of `name` for the unit of work's account: one
// `INSERT … ON CONFLICT DO UPDATE` that creates the counter on first use and otherwise advances it
// under the row lock the update takes, held until the caller's transaction ends. Creators of one
// name in one account serialise on that row; a rollback restores the value, so the numbers are
// monotonic and gap-free.

class SequencesRepository extends ScopedRepository<typeof coreSequences> {
  constructor(uow: UnitOfWork) {
    super(uow, coreSequences);
  }

  /** Advances `name` by `count` and answers the first number of the block. */
  async advance(name: SequenceName, count: number): Promise<number> {
    const row = await this.upsert(
      { name, nextValue: 1 + count },
      [coreSequences.accountId, coreSequences.name],
      { nextValue: sql`${coreSequences.nextValue} + ${count}`, updatedAt: sql`now()` },
    );
    return row.nextValue - count;
  }
}

export class SequenceAllocator {
  /** The next number of `name` in `uow`'s account (1 for the first). */
  async next(uow: UnitOfWork, name: SequenceName): Promise<number> {
    return await this.block(uow, name, 1);
  }

  /** `count` consecutive numbers (a CSV batch, data §7); answers the first. */
  async block(uow: UnitOfWork, name: SequenceName, count: number): Promise<number> {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error('A sequence block holds at least one number');
    }
    return await new SequencesRepository(uow).advance(name, count);
  }
}

/** Display formats of data §7: the prefix and six digits, wider when needed. */
const prefixes: Readonly<Record<SequenceName, string>> = {
  delivery_order: 'D-',
  purchase_order: 'PO-',
  inbound_receipt: 'GR-',
  fulfilment_order: 'F-',
};

/** `D-000123` for order 123; `D-1234567` past six digits. */
export function displayNumber(name: SequenceName, value: number): string {
  return `${prefixes[name]}${String(value).padStart(6, '0')}`;
}

/**
 * The stored number of a display number of `name`, with or without its prefix (`D-000123`,
 * `000123`, `123`; prefix case-insensitive); undefined for anything else (data §7: filtering by a
 * display number parses the prefix).
 */
export function parseDisplayNumber(name: SequenceName, input: string): number | undefined {
  const prefix = prefixes[name];
  let digits = input.trim();
  if (digits.toUpperCase().startsWith(prefix)) digits = digits.slice(prefix.length);
  if (!/^[0-9]{1,15}$/.test(digits)) return undefined;
  const value = Number(digits);
  return value >= 1 ? value : undefined;
}
