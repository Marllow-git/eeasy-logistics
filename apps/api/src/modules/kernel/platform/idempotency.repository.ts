import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { and, isNull, sql } from 'drizzle-orm';
import type { IdempotencyClaim, IdempotencyStore, StoredKey } from '../idempotency/idempotency.js';
import { idempotencyTtlHours } from '../idempotency/idempotency.js';
import { idempotencyStatements } from '../idempotency/idempotency.repository.js';
import { coreIdempotencyKeys } from '../schema/idempotency-keys.js';

/**
 * Idempotency keys of platform staff off the cross-tenant door (data §2.4: account_id NULL). The
 * statements are the tenant store's (`idempotencyStatements`); the scope here adds
 * `account_id IS NULL` to every read and update and inserts NULL, so this store never touches an
 * account's keys.
 */
export class PlatformIdempotencyStore
  extends PlatformRepository<typeof coreIdempotencyKeys>
  implements IdempotencyStore
{
  readonly #statements: IdempotencyStore;

  constructor(uow: PlatformUnitOfWork, ttlHours: number = idempotencyTtlHours) {
    super(uow, coreIdempotencyKeys);
    const tx = this.unscoped();
    const scoped = (condition: SQL) =>
      and(isNull(coreIdempotencyKeys.accountId), condition) ?? sql`false`;
    this.#statements = idempotencyStatements(
      {
        tryLock: async (name) => {
          const rows = await tx.execute<{ locked: boolean }>(
            sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`platform/${name}`}, 0)) AS locked`,
          );
          return rows[0]?.locked === true;
        },
        insertIgnoringConflicts: (values) =>
          tx
            .insert(coreIdempotencyKeys)
            .values({ ...values, accountId: null } as never)
            .onConflictDoNothing()
            .returning({ id: coreIdempotencyKeys.id }),
        findMany: (condition) => tx.select().from(coreIdempotencyKeys).where(scoped(condition)),
        updateWhere: (values, condition) =>
          tx.update(coreIdempotencyKeys).set(values).where(scoped(condition)),
      },
      ttlHours,
    );
  }

  lock(principalId: string, key: string): Promise<boolean> {
    return this.#statements.lock(principalId, key);
  }
  insert(claim: IdempotencyClaim): Promise<string | undefined> {
    return this.#statements.insert(claim);
  }
  find(principalId: string, key: string): Promise<StoredKey | undefined> {
    return this.#statements.find(principalId, key);
  }
  restart(id: string, claim: IdempotencyClaim): Promise<void> {
    return this.#statements.restart(id, claim);
  }
  complete(id: string, status: number, body: unknown): Promise<void> {
    return this.#statements.complete(id, status, body);
  }
}

/** The platform store of the current platform unit of work, or undefined outside one. */
export function currentPlatformIdempotencyStore(): IdempotencyStore | undefined {
  try {
    return new PlatformIdempotencyStore(getPlatformUnitOfWork());
  } catch {
    return undefined;
  }
}
