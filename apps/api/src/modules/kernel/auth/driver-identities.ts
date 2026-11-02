import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { effectiveLimits } from '../accounts/limits.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import { assertRoleCombination } from '../authz/separation.js';
import { ApiException } from '../errors/api-exception.js';
import { MembersRepository } from '../members/members.repository.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import type { IdentityStore } from '../platform/identity.repository.js';
import { identityStoreOnPool } from '../platform/identity.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { UserLocale } from '../schema/identity.js';
import type { SiteKind, SiteStatus } from '../schema/sites.js';
import { SitesRepository } from '../sites/sites.repository.js';
import { countRevocations } from './auth-metrics.js';

// What Delivery's driver doors need of the kernel's identity (DEL-4 plan 2.2, 2.4, 2.5; identity
// and tenancy §2, §3.2, §4; ADR-0023, ADR-0031). A driver is a user with a `driver` membership:
// the person lives on the platform pool (`core_users`, found or created by phone), the membership
// in the request's tenant unit of work (`core_memberships`, under PLAT-12's membership write lock,
// with PLAT-10's role-combination check). The account is always the token's (`getContext()`).
// Pools as PLAT-12 8.2 #3 and #20 rule: each platform step is a transaction of its own that waits
// on nothing the request's app transaction holds (it touches no key column of a row the app side
// references), and the request holds its app connection while it waits for a platform one.

/** The person behind a driver, as the staff doors show it. */
export interface DriverPerson {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly locale: UserLocale;
  readonly disabled: boolean;
}

/** What the driver doors read of the token's account. */
export interface DriverAccount {
  readonly name: string;
  readonly defaultLocale: UserLocale;
  /** `limits.drivers` over the code default (PLAT-12 `effectiveLimits`). */
  readonly driversLimit: number;
}

/** A site of the token's account, as a home site check needs it. */
export interface DriverSite {
  readonly id: string;
  readonly kind: SiteKind;
  readonly status: SiteStatus;
}

export interface DriverIdentitiesDependencies {
  readonly identity: IdentityStore | null;
  readonly accounts: AccountStore | null;
  readonly resolver: Pick<PermissionResolver, 'bundles'> | undefined;
}

export class DriverIdentities {
  readonly #deps: DriverIdentitiesDependencies;
  readonly #logger = new Logger('DriverIdentities');

  constructor(deps: DriverIdentitiesDependencies) {
    this.#deps = deps;
  }

  /** The token's account: its name, default language and driver limit (platform pool, no lock). */
  async account(): Promise<DriverAccount> {
    const store = this.#deps.accounts;
    if (store === null) throw this.#unconfigured();
    const accountId = getContext().accountId;
    const account = await store.run((accounts) => accounts.find(accountId));
    if (account === undefined) throw new Error('The account of the token has no row');
    return {
      name: account.name,
      defaultLocale: account.defaultLocale,
      driversLimit: effectiveLimits(account.limits).drivers,
    };
  }

  /** A site of the token's account in any state, or undefined (another account's included). */
  async site(id: string): Promise<DriverSite | undefined> {
    const row = await new SitesRepository(getUnitOfWork()).find(id);
    return row === undefined ? undefined : { id: row.id, kind: row.kind, status: row.status };
  }

  /**
   * The person with this E.164 phone, created when there is none (a name, the language, the phone;
   * no email, no password) in a platform transaction of its own. An existing person keeps the name
   * and language they have: a person may be a driver of several accounts (identity §1).
   */
  async personByPhone(
    phone: string,
    create: { readonly name: string; readonly locale: UserLocale },
  ): Promise<DriverPerson> {
    const person = await this.#identity().run(async (tx) => {
      const known = await tx.users.findByPhone(phone);
      if (known !== undefined) return known;
      await tx.users.insertByPhone({
        id: uuidv7(),
        name: create.name,
        phone,
        locale: create.locale,
      });
      return tx.users.findByPhone(phone);
    });
    if (person === undefined) throw new Error('The person of a phone was not created');
    return toPerson(person);
  }

  /** The people of `ids` by id (platform pool, read only). */
  async people(ids: readonly string[]): Promise<Map<string, DriverPerson>> {
    if (ids.length === 0) return new Map();
    const users = await this.#identity().run((tx) => tx.users.findByIds(ids));
    return new Map(users.map((user) => [user.id, toPerson(user)]));
  }

  /** A new display name for the person (`updateDriver`, plan 2.4). */
  async rename(userId: string, name: string): Promise<void> {
    await this.#identity().run((tx) => tx.users.rename(userId, name));
  }

  /**
   * Gives the person the `driver` role in the token's account (plan 2.2) under the account's
   * membership write lock, in the tenant unit of work, and returns the membership id: none yet, an
   * `active` membership with `['driver']` and the home site; a `revoked` one comes back `active`
   * with `['driver']` and the home site only (its old roles do not); an `active` one keeps its roles
   * and sites and gains `driver`; an `invited` one is `409 invalid_transition` (its roles are not
   * accepted yet). `assertRoleCombination` runs over the resulting roles first (a cash-handling
   * role with `driver` is `422 role_combination_forbidden`, PLAT-10 A-7).
   */
  async grantDriverRole(userId: string, homeSiteId: string): Promise<string> {
    const members = new MembersRepository(getUnitOfWork());
    await members.lockWrites();
    const existing = await members.findOfUser(userId);
    if (existing === undefined) {
      assertRoleCombination(['driver'], this.#bundles());
      const id = uuidv7();
      await members.insertActive({ id, userId, roles: ['driver'], siteIds: [homeSiteId] });
      return id;
    }
    if (existing.status === 'invited') {
      throw new ApiException('invalid_transition', { details: { current_status: 'invited' } });
    }
    if (existing.status === 'revoked') {
      assertRoleCombination(['driver'], this.#bundles());
      await members.reactivate(existing.id, { roles: ['driver'], siteIds: [homeSiteId] });
      return existing.id;
    }
    const roles = [...new Set([...existing.roles, 'driver'])];
    assertRoleCombination(roles, this.#bundles());
    if (!existing.roles.includes('driver')) {
      await members.write(existing.id, { roles, siteIds: existing.siteIds });
    }
    return existing.id;
  }

  /**
   * A new home site (plan 2.4): a membership holding `driver` alone follows it in `site_ids`; one
   * that also holds staff roles keeps its sites (they scope those roles, not the driver's).
   */
  async moveHome(membershipId: string, homeSiteId: string): Promise<void> {
    const members = new MembersRepository(getUnitOfWork());
    await members.lockWrites();
    const row = await members.find(membershipId);
    if (row === undefined || !isDriverOnly(row.roles)) return;
    await members.write(row.id, { roles: row.roles, siteIds: [homeSiteId] });
  }

  /**
   * The driver archived (plan 2.4): the membership loses `driver`; one holding nothing else is
   * `revoked` (a later `createDriver` brings it back, 2.2).
   */
  async releaseDriverRole(membershipId: string): Promise<void> {
    const members = new MembersRepository(getUnitOfWork());
    await members.lockWrites();
    const row = await members.find(membershipId);
    if (row === undefined || !row.roles.includes('driver')) return;
    if (isDriverOnly(row.roles)) {
      if (row.status !== 'revoked') await members.revoke(row.id);
      return;
    }
    const roles = row.roles.filter((role) => role !== 'driver');
    await members.write(row.id, { roles, siteIds: row.siteIds });
  }

  /**
   * Ends the driver's sessions in a platform transaction of its own (plan 2.4, 2.5): the driver
   * refresh families of the membership, or of one device of it (`deviceId`: the device row's id the
   * refresh rows carry), are revoked; `bumpTokenVersion` also moves the person's `token_version`
   * (a suspension or an archive), so every family of the person is refused at its next rotation.
   * Returns the number of families revoked.
   */
  async endSessions(
    userId: string,
    membershipId: string,
    options: { readonly deviceId?: string; readonly bumpTokenVersion: boolean },
  ): Promise<number> {
    const families = await this.#identity().run(async (tx) => {
      const revoked = await tx.refreshTokens.revokeAll(userId, 'revoked', {
        surface: 'driver',
        membershipId,
        ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
      });
      if (options.bumpTokenVersion) await tx.users.bumpTokenVersion(userId);
      return revoked;
    });
    countRevocations('revoked', families.length);
    return families.length;
  }

  #identity(): IdentityStore {
    const store = this.#deps.identity;
    if (store === null) throw this.#unconfigured();
    return store;
  }

  #bundles(): PermissionResolver['bundles'] {
    const resolver = this.#deps.resolver;
    // Without the resolver (no platform pool at boot) no combination can be checked.
    if (resolver === undefined) throw new ApiException('internal_error');
    return resolver.bundles;
  }

  #unconfigured(): ApiException {
    this.#logger.warn('DATABASE_URL_PLATFORM is not set: the driver doors answer 500');
    return new ApiException('internal_error');
  }
}

function isDriverOnly(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((role) => role === 'driver');
}

function toPerson(user: {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly locale: UserLocale;
  readonly disabled: boolean;
}): DriverPerson {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    locale: user.locale,
    disabled: user.disabled,
  };
}

/** The provider a context module lists (Delivery, DEL-4): the platform pool and the role bundles. */
export const driverIdentitiesProvider: FactoryProvider<DriverIdentities> = {
  provide: DriverIdentities,
  inject: [
    { token: PLATFORM_POOL, optional: true },
    { token: PERMISSION_RESOLVER, optional: true },
  ],
  useFactory: (
    pool: Parameters<typeof identityStoreOnPool>[0] | undefined,
    resolver: PermissionResolver | null | undefined,
  ) =>
    new DriverIdentities({
      identity: identityStoreOnPool(pool ?? null),
      accounts: accountStoreOnPool(pool ?? null),
      resolver: resolver ?? undefined,
    }),
};
