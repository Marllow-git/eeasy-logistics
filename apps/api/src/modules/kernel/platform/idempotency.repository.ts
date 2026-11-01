import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { IdempotencyClaim, IdempotencyStore, StoredKey } from '../idempotency/idempotency.js';
import { expiresAtFromNow, storedKey } from '../idempotency/idempotency.repository.js';
import { coreIdempotencyKeys } from '../schema/idempotency-keys.js';

/**
 * Idempotency keys of platform staff off the cross-tenant door (data §2.4: account_id NULL). Every
 * statement names `account_id IS NULL`, so this store never touches an account's keys.
 */
export class PlatformIdempotencyStore
  extends PlatformRepository<typeof coreIdempotencyKeys>
  implements IdempotencyStore
{
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreIdempotencyKeys);
  }

  private own(principalId: string, key: string) {
    return and(
      isNull(coreIdempotencyKeys.accountId),
      eq(coreIdempotencyKeys.principalId, principalId),
      eq(coreIdempotencyKeys.key, key),
    );
  }

  async lock(principalId: string, key: string): Promise<boolean> {
    const rows = await this.unscoped().execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`platform/idempotency/${principalId}/${key}`}, 0)) AS locked`,
    );
    return rows[0]?.locked === true;
  }

  async insert(claim: IdempotencyClaim): Promise<string | undefined> {
    const [row] = await this.unscoped()
      .insert(coreIdempotencyKeys)
      .values({
        id: uuidv7(),
        accountId: null,
        ...claim,
        state: 'in_progress',
        expiresAt: expiresAtFromNow as never,
      })
      .onConflictDoNothing()
      .returning({ id: coreIdempotencyKeys.id });
    return row?.id;
  }

  async find(principalId: string, key: string): Promise<StoredKey | undefined> {
    const [row] = await this.unscoped()
      .select()
      .from(coreIdempotencyKeys)
      .where(this.own(principalId, key));
    return row === undefined ? undefined : storedKey(row);
  }

  async restart(id: string, claim: IdempotencyClaim): Promise<void> {
    await this.unscoped()
      .update(coreIdempotencyKeys)
      .set({
        route: claim.route,
        requestHash: claim.requestHash,
        state: 'in_progress',
        responseStatus: null,
        responseBody: null,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
        expiresAt: expiresAtFromNow,
      })
      .where(and(eq(coreIdempotencyKeys.id, id), isNull(coreIdempotencyKeys.accountId)));
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.unscoped()
      .update(coreIdempotencyKeys)
      .set({
        state: 'completed',
        responseStatus: status,
        responseBody: body,
        updatedAt: sql`now()`,
        expiresAt: sql`${coreIdempotencyKeys.createdAt} + interval '24 hours'`,
      })
      .where(and(eq(coreIdempotencyKeys.id, id), isNull(coreIdempotencyKeys.accountId)));
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
