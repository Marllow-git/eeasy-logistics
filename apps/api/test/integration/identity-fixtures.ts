// Identity rows for the sign-in tests (PLAT-11), written as the owner (no policy applies), and the
// cookie jar a browser would keep. Each test makes its own account, user and email.
import { randomBytes } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';

export interface FixtureUser {
  readonly id: string;
  readonly email: string;
}

export function freshEmail(label = 'staff'): string {
  return `${label}-${randomBytes(6).toString('hex')}@example.test`;
}

export async function insertAccount(
  owner: postgres.Sql,
  options: { status?: string; name?: string; secondFactorRequired?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  const settings = options.secondFactorRequired === true ? { second_factor_required: true } : {};
  await owner`
    INSERT INTO core_accounts (id, name, status, settings)
    VALUES (${id}, ${options.name ?? `Account ${id.slice(-6)}`}, ${options.status ?? 'active'},
            ${owner.json(settings)})`;
  return id;
}

export async function insertUser(
  owner: postgres.Sql,
  options: {
    email?: string;
    passwordHash?: string | null;
    name?: string;
    locale?: 'ar' | 'en';
    secondFactorPhone?: string;
  } = {},
): Promise<FixtureUser> {
  const id = uuidv7();
  const email = options.email ?? freshEmail();
  await owner`
    INSERT INTO core_users (id, name, email, locale, password_hash, second_factor_enabled,
                            second_factor_phone)
    VALUES (${id}, ${options.name ?? 'Test User'}, ${email}, ${options.locale ?? 'en'},
            ${options.passwordHash ?? null}, ${options.secondFactorPhone !== undefined},
            ${options.secondFactorPhone ?? null})`;
  return { id, email };
}

export async function insertMembership(
  owner: postgres.Sql,
  accountId: string,
  userId: string,
  options: { roles?: string[]; status?: string; siteIds?: string[] } = {},
): Promise<string> {
  const id = uuidv7();
  await owner`
    INSERT INTO core_memberships (id, account_id, user_id, roles, site_ids, status)
    VALUES (${id}, ${accountId}, ${userId}, ${options.roles ?? ['owner']},
            ${options.siteIds ?? []}::uuid[], ${options.status ?? 'active'})`;
  return id;
}

export async function insertPlatformStaff(
  owner: postgres.Sql,
  userId: string,
  role: 'super_admin' | 'admin' | 'support' = 'super_admin',
): Promise<void> {
  await owner`INSERT INTO core_platform_staff (user_id, role) VALUES (${userId}, ${role})`;
}

/**
 * A live platform staff member for a minted platform token's `sub` (PLAT-13 adversary M-1: the
 * permission guard admits a platform token only while its stored staff row is live and holds the
 * token's role). `id` is the token's `sub` (a fresh one by default); returns it.
 */
export async function insertPlatformSubject(
  owner: postgres.Sql,
  role: 'super_admin' | 'admin' | 'support' = 'super_admin',
  id: string = uuidv7(),
): Promise<string> {
  await owner`
    INSERT INTO core_users (id, name, email, locale)
    VALUES (${id}, 'Platform Subject', ${freshEmail('platform-subject')}, 'en')`;
  await insertPlatformStaff(owner, id, role);
  return id;
}

/** The `Set-Cookie` values of a response, by cookie name: value and Max-Age. */
export function setCookies(
  headers: Record<string, unknown>,
): Map<string, { value: string; maxAge: number; raw: string }> {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const cookies = new Map<string, { value: string; maxAge: number; raw: string }>();
  for (const line of list) {
    const [pair] = line.split(';');
    const separator = (pair ?? '').indexOf('=');
    const name = (pair ?? '').slice(0, separator);
    const value = (pair ?? '').slice(separator + 1);
    const maxAge = Number(/Max-Age=(\d+)/.exec(line)?.[1] ?? NaN);
    cookies.set(name, { value, maxAge, raw: line });
  }
  return cookies;
}

/** A `Cookie` header from name and value pairs. */
export function cookieHeader(pairs: Record<string, string | undefined>): string {
  return Object.entries(pairs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
