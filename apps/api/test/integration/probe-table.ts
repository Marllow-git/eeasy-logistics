// A throwaway tenant table for the request-frame integration tests (PLAT-6): created by the owner
// in a scratch schema (PLAT-5 convention: never in public, so the schema test never sees it) with
// the template policies of data §4.3, RLS enabled when the run has ELX_RLS=on.
import { randomBytes } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import type { TenantInsert, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';

export const probeSchema = `scratch_${randomBytes(4).toString('hex')}`;

export const probeRows = pgSchema(probeSchema).table('probe_rows', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  label: text('label').notNull(),
});

export interface ProbeRow {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
}

/** The probe repository: the tenant repository base, nothing else. */
export class ProbeRepository extends ScopedRepository<typeof probeRows> {
  constructor(uow: UnitOfWork) {
    super(uow, probeRows);
  }
  all() {
    return this.findMany();
  }
  add(row: TenantInsert<typeof probeRows>) {
    return this.insertMany([row]);
  }
}

export async function createProbeTable(owner: postgres.Sql, config: Config): Promise<void> {
  const name = `"${probeSchema}".probe_rows`;
  await owner.unsafe(`CREATE SCHEMA "${probeSchema}"`);
  await owner.unsafe(
    `CREATE TABLE ${name} (id uuid PRIMARY KEY, account_id uuid NOT NULL, label text NOT NULL)`,
  );
  await owner.unsafe(`GRANT USAGE ON SCHEMA "${probeSchema}" TO elx_app, elx_platform`);
  await owner.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${name} TO elx_app, elx_platform`);
  await owner.unsafe(`
    CREATE POLICY tenant_isolation ON ${name} TO elx_app
      USING (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid)
      WITH CHECK (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid)`);
  await owner.unsafe(
    `CREATE POLICY platform_access ON ${name} TO elx_platform USING (true) WITH CHECK (true)`,
  );
  if (config.db.rls) await owner.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
}

export async function insertProbeRows(
  owner: postgres.Sql,
  rows: readonly { id: string; accountId: string; label: string }[],
): Promise<void> {
  for (const row of rows) {
    await owner.unsafe(
      `INSERT INTO "${probeSchema}".probe_rows (id, account_id, label) VALUES ($1, $2, $3)`,
      [row.id, row.accountId, row.label],
    );
  }
}

/** The labels of `account`'s probe rows, read as the owner (outside any policy). */
export async function probeLabels(owner: postgres.Sql, account: string): Promise<string[]> {
  const rows = await owner.unsafe<{ label: string }[]>(
    `SELECT label FROM "${probeSchema}".probe_rows WHERE account_id = $1 ORDER BY label`,
    [account],
  );
  return rows.map((row) => row.label);
}

export async function dropProbeTable(owner: postgres.Sql): Promise<void> {
  await owner.unsafe(`DROP SCHEMA IF EXISTS "${probeSchema}" CASCADE`);
}
