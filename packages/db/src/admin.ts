// Superuser tooling for local and ci only (PLAT-5 plan 2.8, 2.9; data §11.7): scratch databases for
// the integration suite and the `elx_seed` template. Every URL is derived from a configured one
// (`config.db.urls.*`); `DATABASE_URL_ADMIN` is refused in staging and production by packages/config.
// The apps/api architecture test allows this entry only in `src/seed/`; tests may use it too.
import { Secret } from '@eeasy-logistics/config';
import postgres from 'postgres';

/** A database name this tooling may create or drop: lower-case, PostgreSQL identifier length. */
const databaseName = /^[a-z_][a-z0-9_]{0,62}$/;

function checkName(name: string): string {
  if (!databaseName.test(name)) throw new Error('Invalid database name');
  return name;
}

/** The same connection URL pointing at another database on the same server. */
export function withDatabase(url: Secret, database: string): Secret {
  const parsed = new URL(url.reveal());
  parsed.pathname = `/${checkName(database)}`;
  return new Secret(parsed.toString());
}

/** The database a connection URL points at. */
export function databaseOf(url: Secret): string {
  return checkName(decodeURIComponent(new URL(url.reveal()).pathname.slice(1)));
}

function connect(url: Secret): postgres.Sql {
  return postgres(url.reveal(), { max: 1, connect_timeout: 10, onnotice: () => undefined });
}

/** The extensions the first migration expects (ADR-0019); only a superuser may create postgis. */
const extensions = ['postgis', 'citext', 'pgcrypto'] as const;

/**
 * Drops `name` if it exists and creates it empty from `template1`, owned by `elx_owner`, with the
 * three extensions created by the superuser (a native server's template1 may not have them).
 */
export async function recreateDatabase(admin: Secret, name: string): Promise<void> {
  const server = connect(admin);
  try {
    await server`DROP DATABASE IF EXISTS ${server(checkName(name))} WITH (FORCE)`;
    await server`CREATE DATABASE ${server(name)} OWNER elx_owner TEMPLATE template1`;
  } finally {
    await server.end({ timeout: 5 });
  }
  const database = connect(withDatabase(admin, name));
  try {
    for (const extension of extensions) {
      await database`CREATE EXTENSION IF NOT EXISTS ${database(extension)}`;
    }
  } finally {
    await database.end({ timeout: 5 });
  }
}

/** Drops `name`, closing any connection still open on it. */
export async function dropDatabase(admin: Secret, name: string): Promise<void> {
  const server = connect(admin);
  try {
    await server`DROP DATABASE IF EXISTS ${server(checkName(name))} WITH (FORCE)`;
  } finally {
    await server.end({ timeout: 5 });
  }
}
