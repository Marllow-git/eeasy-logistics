import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, uuidv7 } from '@eeasy-logistics/db';
import { and, eq, sql } from 'drizzle-orm';
import { coreIdempotencyKeys } from '../schema/idempotency-keys.js';
import type { IdempotencyClaim, IdempotencyStore, StoredKey } from './idempotency.js';
import { idempotencyTtlHours } from './idempotency.js';

const ttl = sql.raw(`interval '${idempotencyTtlHours} hours'`);

/** `expires_at` for a row created now (data §5.1: created_at + 24 h). */
export const expiresAtFromNow = sql`now() + ${ttl}`;

export type IdempotencyRow = typeof coreIdempotencyKeys.$inferSelect;

export function storedKey(row: IdempotencyRow, now: number = Date.now()): StoredKey {
  return {
    id: row.id,
    requestHash: row.requestHash,
    state: row.state,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    expired: row.expiresAt.getTime() < now,
  };
}

/**
 * Idempotency keys of the unit of work's account (staff, driver, and platform staff through the
 * cross-tenant door): the repository base adds the account to every statement.
 */
export class TenantIdempotencyStore
  extends ScopedRepository<typeof coreIdempotencyKeys>
  implements IdempotencyStore
{
  constructor(uow: UnitOfWork) {
    super(uow, coreIdempotencyKeys);
  }

  lock(principalId: string, key: string): Promise<boolean> {
    return this.tryTransactionLock(`idempotency/${principalId}/${key}`);
  }

  async insert(claim: IdempotencyClaim): Promise<string | undefined> {
    const [row] = await this.insertIgnoringConflicts([
      { id: uuidv7(), ...claim, state: 'in_progress', expiresAt: expiresAtFromNow as never },
    ]);
    return row?.id;
  }

  async find(principalId: string, key: string): Promise<StoredKey | undefined> {
    const [row] = await this.findMany(
      and(eq(coreIdempotencyKeys.principalId, principalId), eq(coreIdempotencyKeys.key, key)),
    );
    return row === undefined ? undefined : storedKey(row);
  }

  async restart(id: string, claim: IdempotencyClaim): Promise<void> {
    await this.updateWhere(
      {
        route: claim.route,
        requestHash: claim.requestHash,
        principalType: claim.principalType,
        state: 'in_progress',
        responseStatus: null,
        responseBody: null,
        createdAt: sql`now()` as never,
        updatedAt: sql`now()` as never,
        expiresAt: expiresAtFromNow as never,
      },
      eq(coreIdempotencyKeys.id, id),
    );
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.updateWhere(
      {
        state: 'completed',
        responseStatus: status,
        responseBody: body,
        updatedAt: sql`now()` as never,
        expiresAt: sql`${coreIdempotencyKeys.createdAt} + ${ttl}` as never,
      },
      eq(coreIdempotencyKeys.id, id),
    );
  }
}
