import type { InferInsertModel, InferSelectModel, SQL } from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { UnitOfWork } from './unit-of-work.ts';

/** A tenant table: declares its `account_id` column as `accountId` (data §1.3, ADR-0025). */
export type TenantTable = PgTable & { readonly accountId: PgColumn };

/** An insert row without `accountId`: the repository sets it from the context. */
export type TenantInsert<TTable extends TenantTable> = Omit<InferInsertModel<TTable>, 'accountId'>;

/** Columns an update may change; `accountId` never moves (a row cannot change tenant). */
export type TenantUpdate<TTable extends TenantTable> = Partial<TenantInsert<TTable>>;

/**
 * The repository base for tenant tables (data §4.2). Every read, update and delete carries
 * `account_id = <context account>` and every insert sets `account_id` from the context, never from
 * input. The transaction is private: there is no way to omit the predicate here. Omitting it needs
 * `unscoped()`, which only `PlatformRepository` (`@eeasy-logistics/db/platform`) has.
 */
export abstract class ScopedRepository<TTable extends TenantTable> {
  readonly #uow: UnitOfWork;
  protected readonly table: TTable;

  constructor(uow: UnitOfWork, table: TTable) {
    this.#uow = uow;
    this.table = table;
  }

  /** The account every statement of this repository is limited to. */
  protected get accountId(): string {
    return this.#uow.context.accountId;
  }

  /** `account_id = <context account>`, and `condition` when given. */
  protected scoped(condition?: SQL): SQL {
    const tenant = eq(this.table.accountId, this.accountId);
    return condition === undefined ? tenant : (and(tenant, condition) ?? tenant);
  }

  protected async findMany(condition?: SQL): Promise<InferSelectModel<TTable>[]> {
    const table: PgTable = this.table;
    const rows = await this.#uow.tx.select().from(table).where(this.scoped(condition));
    return rows as InferSelectModel<TTable>[];
  }

  protected async insertMany(
    rows: readonly TenantInsert<TTable>[],
  ): Promise<InferSelectModel<TTable>[]> {
    if (rows.length === 0) return [];
    const values = rows.map((row) => ({ ...withoutAccount(row), accountId: this.accountId }));
    const inserted = await this.#uow.tx
      .insert(this.table)
      .values(values as never)
      .returning();
    return inserted;
  }

  protected async updateWhere(
    values: TenantUpdate<TTable>,
    condition?: SQL,
  ): Promise<InferSelectModel<TTable>[]> {
    if (Object.hasOwn(values, 'accountId')) {
      throw new Error('A repository update cannot change account_id');
    }
    const updated = await this.#uow.tx
      .update(this.table)
      .set(values as never)
      .where(this.scoped(condition))
      .returning();
    return updated as InferSelectModel<TTable>[];
  }

  protected async deleteWhere(condition?: SQL): Promise<InferSelectModel<TTable>[]> {
    const deleted = await this.#uow.tx.delete(this.table).where(this.scoped(condition)).returning();
    return deleted;
  }
}

/** Drops an `accountId` smuggled into an insert row (the type forbids it; input may not). */
function withoutAccount(row: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.accountId;
  return copy;
}
