import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, uuidv7 } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { and, eq, sql } from 'drizzle-orm';
import { coreIdempotencyKeys } from '../schema/idempotency-keys.js';
import type { IdempotencyClaim, IdempotencyStore, StoredKey } from './idempotency.js';
import { idempotencyTtlHours } from './idempotency.js';

export type IdempotencyRow = typeof coreIdempotencyKeys.$inferSelect;
/** Column values for an insert or update; the scope sets `account_id` itself. */
export type IdempotencyValues = Record<string, unknown>;

/**
 * The scoped primitives one store offers (review round 1): the tenant store gets them from the
 * repository base (`account_id = <context account>`), the platform store adds `account_id IS NULL`
 * itself. `idempotencyStatements` writes every statement once on top of them.
 */
export interface ScopedStatements {
  tryLock(name: string): Promise<boolean>;
  insertIgnoringConflicts(values: IdempotencyValues): Promise<readonly { id: string }[]>;
  findMany(condition: SQL): Promise<readonly IdempotencyRow[]>;
  updateWhere(values: IdempotencyValues, condition: SQL): Promise<unknown>;
}

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
 * The idempotency statements of data §5.1, once for both stores. `ttlHours` (24, data §5.1) sets
 * `expires_at` at reserve (`now() + ttl`) and at completion (`created_at + ttl`).
 */
export function idempotencyStatements(
  scope: ScopedStatements,
  ttlHours: number = idempotencyTtlHours,
): IdempotencyStore {
  if (!Number.isInteger(ttlHours) || ttlHours <= 0)
    throw new Error('ttlHours is a positive integer');
  const ttl = sql.raw(`interval '${ttlHours} hours'`);
  const byId = (id: string) => eq(coreIdempotencyKeys.id, id);
  return {
    lock: (principalId, key) => scope.tryLock(`idempotency/${principalId}/${key}`),

    insert: async (claim: IdempotencyClaim) => {
      const [row] = await scope.insertIgnoringConflicts({
        id: uuidv7(),
        ...claim,
        state: 'in_progress',
        expiresAt: sql`now() + ${ttl}`,
      });
      return row?.id;
    },

    find: async (principalId, key) => {
      const [row] = await scope.findMany(
        and(eq(coreIdempotencyKeys.principalId, principalId), eq(coreIdempotencyKeys.key, key)) ??
          sql`false`,
      );
      return row === undefined ? undefined : storedKey(row);
    },

    restart: async (id, claim) => {
      await scope.updateWhere(
        {
          route: claim.route,
          requestHash: claim.requestHash,
          principalType: claim.principalType,
          state: 'in_progress',
          responseStatus: null,
          responseBody: null,
          createdAt: sql`now()`,
          updatedAt: sql`now()`,
          expiresAt: sql`now() + ${ttl}`,
        },
        byId(id),
      );
    },

    complete: async (id, status, body) => {
      await scope.updateWhere(
        {
          state: 'completed',
          responseStatus: status,
          responseBody: body,
          updatedAt: sql`now()`,
          expiresAt: sql`${coreIdempotencyKeys.createdAt} + ${ttl}`,
        },
        byId(id),
      );
    },

    release: async (id) => {
      await scope.updateWhere(
        { expiresAt: sql`now() - interval '1 second'`, updatedAt: sql`now()` },
        and(byId(id), eq(coreIdempotencyKeys.state, 'in_progress')) ?? sql`false`,
      );
    },
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
  readonly #statements: IdempotencyStore;

  constructor(uow: UnitOfWork, ttlHours: number = idempotencyTtlHours) {
    super(uow, coreIdempotencyKeys);
    this.#statements = idempotencyStatements(
      {
        tryLock: (name) => this.tryTransactionLock(name),
        insertIgnoringConflicts: (values) => this.insertIgnoringConflicts([values as never]),
        findMany: (condition) => this.findMany(condition),
        updateWhere: (values, condition) => this.updateWhere(values, condition),
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
  release(id: string): Promise<void> {
    return this.#statements.release(id);
  }
}
