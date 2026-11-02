import type { InferInsertModel, InferSelectModel, SQL } from 'drizzle-orm';
import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Transaction, UnitOfWork } from './unit-of-work.ts';
import { transactionOf } from './unit-of-work.ts';

/** A tenant table: declares its `account_id` column as `accountId` (data §1.3, ADR-0025). */
export type TenantTable = PgTable & { readonly accountId: PgColumn };

/** An insert row without `accountId`: the repository sets it from the context. */
export type TenantInsert<TTable extends TenantTable> = Omit<InferInsertModel<TTable>, 'accountId'>;

/** Columns an update may change; `accountId` never moves (a row cannot change tenant). */
export type TenantUpdate<TTable extends TenantTable> = Partial<TenantInsert<TTable>>;

/**
 * The repository base for tenant tables (data §4.2). Every read, update and delete carries
 * `account_id = <context account>` and every insert sets `account_id` from the context, never from
 * input. The transaction is private (the unit of work does not expose it either, review M-1):
 * there is no way to omit the predicate here. Omitting it needs
 * `unscoped()`, which only `PlatformRepository` (`@eeasy-logistics/db/platform`) has.
 */
export abstract class ScopedRepository<TTable extends TenantTable> {
  readonly #uow: UnitOfWork;
  protected readonly table: TTable;

  constructor(uow: UnitOfWork, table: TTable) {
    this.#uow = uow;
    transactionOf(uow); // fails now on a foreign or closed unit of work
    this.table = table;
  }

  /** Resolved on every statement: `UnitOfWorkClosedError` once the transaction ended (M-1). */
  get #tx(): Transaction {
    return transactionOf(this.#uow);
  }

  /** The account every statement of this repository is limited to. */
  protected get accountId(): string {
    return this.#uow.context.accountId;
  }

  /**
   * `account_id = <context account> AND (<condition>)`. The caller's condition is bracketed on its
   * own: Drizzle's `and()` does not bracket its parts, so a raw `x OR true` would otherwise bind
   * looser than the tenant predicate and escape it (review H-1).
   */
  protected scoped(condition?: SQL): SQL {
    const tenant = eq(this.table.accountId, this.accountId);
    return condition === undefined ? tenant : (and(tenant, sql`(${condition})`) ?? tenant);
  }

  /**
   * Rows of the context's account matching `condition`, optionally ordered and limited (keyset
   * pages, ADR-0029: the caller puts its cursor predicate in `condition`).
   */
  protected async findMany(
    condition?: SQL,
    page: { readonly orderBy?: readonly SQL[]; readonly limit?: number } = {},
  ): Promise<InferSelectModel<TTable>[]> {
    const table: PgTable = this.table;
    const query = this.#tx
      .select()
      .from(table)
      .where(this.scoped(condition))
      .orderBy(...(page.orderBy ?? []))
      .$dynamic();
    const rows = page.limit === undefined ? await query : await query.limit(page.limit);
    return rows as InferSelectModel<TTable>[];
  }

  /** How many rows of the context's account match `condition` (a limit check, a usage figure). */
  protected async countWhere(condition?: SQL): Promise<number> {
    const table: PgTable = this.table;
    const [row] = await this.#tx
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(this.scoped(condition));
    return row?.count ?? 0;
  }

  protected async insertMany(
    rows: readonly TenantInsert<TTable>[],
  ): Promise<InferSelectModel<TTable>[]> {
    if (rows.length === 0) return [];
    const values = rows.map((row) => ({ ...withoutAccount(row), accountId: this.accountId }));
    const inserted = await this.#tx
      .insert(this.table)
      .values(values as never)
      .returning();
    return inserted;
  }

  /**
   * Inserts rows whose unique key does not exist yet and returns those inserted (`ON CONFLICT DO
   * NOTHING`): a duplicate is no error, so the transaction stays usable (idempotency reserve).
   */
  protected async insertIgnoringConflicts(
    rows: readonly TenantInsert<TTable>[],
  ): Promise<InferSelectModel<TTable>[]> {
    if (rows.length === 0) return [];
    const values = rows.map((row) => ({ ...withoutAccount(row), accountId: this.accountId }));
    const inserted = await this.#tx
      .insert(this.table)
      .values(values as never)
      .onConflictDoNothing()
      .returning();
    return inserted;
  }

  /**
   * Takes a transaction-scoped advisory lock on `<account>/<name>` without waiting: true when this
   * transaction holds it (until commit or rollback), false when another transaction does.
   */
  protected async tryTransactionLock(name: string): Promise<boolean> {
    const rows = await this.#tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`${this.accountId}/${name}`}, 0)) AS locked`,
    );
    return rows[0]?.locked === true;
  }

  /**
   * Takes a transaction-scoped advisory lock on `<account>/<name>`, waiting for the transaction
   * that holds it: writes of one account that check a count before they insert (a limit) run one
   * after the other, each seeing the rows the previous one committed.
   */
  protected async transactionLock(name: string): Promise<void> {
    await this.#tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.accountId}/${name}`}, 0))`,
    );
  }

  protected async updateWhere(
    values: TenantUpdate<TTable>,
    condition?: SQL,
  ): Promise<InferSelectModel<TTable>[]> {
    if (Object.hasOwn(values, 'accountId')) {
      throw new Error('A repository update cannot change account_id');
    }
    const updated = await this.#tx
      .update(this.table)
      .set(values as never)
      .where(this.scoped(condition))
      .returning();
    return updated as InferSelectModel<TTable>[];
  }

  protected async deleteWhere(condition?: SQL): Promise<InferSelectModel<TTable>[]> {
    const deleted = await this.#tx.delete(this.table).where(this.scoped(condition)).returning();
    return deleted;
  }
}

/** Drops an `accountId` smuggled into an insert row (the type forbids it; input may not). */
function withoutAccount(row: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.accountId;
  return copy;
}
