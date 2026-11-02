import type { RequestContext } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// Helpers of the system jobs that scan on the platform pool and write per account on elx_app
// (DEL-5 leg 1 ruling on 8.2 #1: elx_platform only reads the shift and location tables).

/** The context of a system write in one account: no member, no user, no device. */
export function systemContext(accountId: string): RequestContext {
  return {
    accountId,
    membershipId: null,
    userId: null,
    deviceId: null,
    actingCrossTenant: false,
  };
}

/**
 * `AND <column> IN (<accounts>)` when a run is scoped to some accounts (the integration suites,
 * which share one database with suites whose rows a whole-database run would touch), else nothing.
 */
export function accountScope(column: SQL, accounts: readonly string[] | undefined): SQL {
  if (accounts === undefined) return sql``;
  if (accounts.length === 0) return sql` AND false`;
  return sql` AND ${column} IN (${sql.join(
    accounts.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
