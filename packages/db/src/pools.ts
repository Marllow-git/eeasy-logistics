import type { Secret } from '@eeasy-logistics/config';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection pools per database role (data §4.4, ADR-0031). Every URL comes from packages/config
// (`config.db.urls`); this package never holds a connection string of its own.

declare const role: unique symbol;

/** A Drizzle database on one role's pool. The brand keeps the app and platform pools apart. */
export type RoleDatabase<Role extends string> = PostgresJsDatabase & { readonly [role]: Role };

/** The `elx_app` pool: tenant work, always through `withUnitOfWork`. */
export type AppDatabase = RoleDatabase<'app'>;

export interface Pool<Database> {
  readonly db: Database;
  /** Waits for in-flight queries (at most 5 s), then closes every connection. */
  close(): Promise<void>;
}

export interface PoolOptions {
  readonly max: number;
  /** Shown in `pg_stat_activity.application_name`. */
  readonly name: string;
}

/** Opens a pool on `url`, revealed here at the point of use only. */
export function openPool<Role extends string>(
  url: Secret | undefined,
  variable: string,
  options: PoolOptions,
): Pool<RoleDatabase<Role>> {
  if (url === undefined) throw new Error(`${variable} is not configured`);
  const client = postgres(url.reveal(), {
    max: options.max,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: { application_name: options.name },
  });
  return {
    db: drizzle({ client }) as unknown as RoleDatabase<Role>,
    close: () => client.end({ timeout: 5 }),
  };
}

/** The part of `Config['db']` the app pool needs. */
export interface AppPoolSettings {
  readonly urls: { readonly app: Secret | undefined };
  readonly poolSize: { readonly app: number };
}

/** What `verifyPoolRole` reads about the pool's login role. */
export interface PoolRoleFacts {
  readonly who: string;
  readonly superuser: boolean;
  readonly bypass: boolean;
  /** Member of `elx_owner`: it could act as the table owner, which RLS does not apply to. */
  readonly ownerMember: boolean;
}

/** Whether `facts` describe a plain `expected` login (pure, so it is unit-tested). */
export function isPlainPoolRole(
  facts: PoolRoleFacts | undefined,
  expected: 'elx_app' | 'elx_platform',
): boolean {
  return (
    facts !== undefined &&
    facts.who === expected &&
    !facts.superuser &&
    !facts.bypass &&
    !facts.ownerMember
  );
}

/**
 * Proves a pool is what it claims (review M-6, N-2): logged in as `expected`, and that role is
 * neither superuser nor BYPASSRLS nor a member of `elx_owner` (which would let it act as the table
 * owner, outside RLS and with every privilege), so the policies and the withheld grants apply to
 * it. Throws otherwise; the message names the expected role only, never the URL.
 */
export async function verifyPoolRole(
  db: PostgresJsDatabase,
  expected: 'elx_app' | 'elx_platform',
): Promise<void> {
  const rows = await db.execute<{
    who: string;
    superuser: boolean;
    bypass: boolean;
    owner_member: boolean;
  }>(
    sql`SELECT current_user AS who, rolsuper AS superuser, rolbypassrls AS bypass,
               pg_has_role(current_user, 'elx_owner', 'USAGE') AS owner_member
        FROM pg_roles WHERE rolname = current_user`,
  );
  const row = rows[0];
  const facts = row === undefined ? undefined : { ...row, ownerMember: row.owner_member };
  if (!isPlainPoolRole(facts, expected)) {
    throw new Error(`The pool is not a plain ${expected} connection`);
  }
}

/** The `elx_app` pool (ADR-0031): the only pool tenant code receives. */
export function createAppPool(db: AppPoolSettings, name = 'elx-api'): Pool<AppDatabase> {
  return openPool<'app'>(db.urls.app, 'DATABASE_URL_APP', { max: db.poolSize.app, name });
}
