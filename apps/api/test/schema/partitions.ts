import type postgres from 'postgres';

// The partition checks of the tenancy schema test (PLAT-5 plan §6 "Partitions", review M-4;
// PLAT-7 plan 2.3). A partition is reached only through its parent, whose grants, triggers and
// policies apply; a privilege on a partition itself would let a runtime role read or write it
// around the parent's policies. Exported so a test can plant a grant in a rolled-back transaction
// and see the check go red.

export const runtimeRoles = ['elx_app', 'elx_platform'] as const;
const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

/** `<partition>: <role> may <privileges>` for every partition in public a runtime role can use. */
export async function partitionGrantProblems(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<string[]> {
  const rows = await sql<{ partition: string; role: string; granted: string }[]>`
    SELECT c.relname AS partition, r AS role, string_agg(p, ', ' ORDER BY p) AS granted
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(${runtimeRoles}::text[]) r
    CROSS JOIN unnest(${privileges}::text[]) p
    WHERE n.nspname = 'public' AND c.relispartition
      AND has_table_privilege(r, c.oid, p)
    GROUP BY c.relname, r
    ORDER BY c.relname, r`;
  return rows.map((row) => `${row.partition}: ${row.role} may ${row.granted}`);
}

/** The partitions of `parent` (direct children), by name. */
export async function partitionsOf(
  sql: postgres.Sql | postgres.TransactionSql,
  parent: string,
): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = ${parent}::regclass ORDER BY c.relname`;
  return rows.map((row) => row.name);
}
