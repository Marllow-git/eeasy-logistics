import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type {
  AuditSink,
  DriverIdentities,
  DriverPerson,
  DriverStatus,
  ListPage,
  ListPagePlan,
  OutboxWriter,
  PageKey,
  RequestFacts,
} from '../../kernel/public/index.js';
import {
  ApiException,
  keysetSlice,
  oneLineTextProblem,
  phoneTail,
  templateParamsProblem,
} from '../../kernel/public/index.js';
import {
  capacityRefusal,
  driverMatches,
  homeSiteRefusal,
  maxDriverNameLength,
  personProblems,
  statusChangeAllowed,
} from './driver-input.js';
import type { DriverRow } from './drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from './drivers.repository.js';

// The staff driver doors (DEL-4 plan 2.2 to 2.4; domain model §3.5; identity and tenancy §2,
// §3.2, §4; ADR-0023, ADR-0025, ADR-0031). The account is always the token's (`getContext()`).
// Drivers, devices and the audit rows are written in the request's tenant unit of work under the
// account's driver write lock; the person (name, phone, sessions, `token_version`) lives on the
// platform pool and is reached through the kernel's `DriverIdentities`, one platform transaction
// per step, taken before the tenant writes so no platform step waits on the request (PLAT-12 8.2
// #3, #29). The WhatsApp app invitation is a `message` outbox row in the same tenant transaction.

export type AuditFacts = Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>;

/** The documented sort fields of `listDrivers` (plan 2.4; `name` is the person's). */
export type DriverSortField = 'created_at' | 'name' | 'status';

/** A driver row with the person it belongs to. */
export interface Driver {
  readonly row: DriverRow;
  readonly person: DriverPerson;
}

/** `CreateDriverRequest` as the controller hands it over (contract types stay there, A-17). */
export interface DriverCreate {
  readonly name: string;
  readonly phone: string;
  readonly home_site_id: string;
  readonly capacity_limit: number;
  readonly locale?: 'ar' | 'en' | undefined;
}

/** `UpdateDriverRequest`: an absent field keeps its stored value. */
export interface DriverPatch {
  readonly name?: string | undefined;
  readonly home_site_id?: string | undefined;
  readonly status?: DriverStatus | undefined;
  readonly capacity_limit?: number | undefined;
}

export interface DriverListRequest {
  readonly plan: ListPagePlan<DriverSortField>;
  readonly statuses: readonly DriverStatus[] | undefined;
  readonly homeSiteId: string | undefined;
  readonly cashBlocked: boolean | undefined;
  /** The trimmed `q`, or undefined. */
  readonly q: string | undefined;
}

/** The orders a driver holds (D-10's `CapacityCounter`): DEL-6 keeps it, zero until then. */
export const activeOrdersOf = (row: DriverRow): number => {
  void row;
  return 0;
};

/** The cursor key of a driver for `field`. */
export function driverKeyOf(field: DriverSortField, driver: Driver): PageKey {
  const value =
    field === 'created_at'
      ? driver.row.createdAt.toISOString()
      : field === 'name'
        ? driver.person.name
        : driver.row.status;
  return { value, id: driver.row.id };
}

/** The audited fields of a driver (the phone as its tail only, plan 2.2, 2.12). */
function auditFields(driver: Driver): Record<string, unknown> {
  return {
    name: driver.person.name,
    phone_tail: driver.person.phone === null ? null : phoneTail(driver.person.phone),
    home_site_id: driver.row.homeSiteId,
    status: driver.row.status,
    capacity_limit: driver.row.capacityLimit,
  };
}

export class DriversService {
  readonly #logger = new Logger('Drivers');

  constructor(
    private readonly deps: {
      readonly identities: DriverIdentities;
      readonly audit: AuditSink;
      readonly outbox: Pick<OutboxWriter, 'enqueue'>;
      /** `DRIVER_APP_URL`: the invitation's link (plan 2.3). */
      readonly appUrl: string;
    },
  ) {}

  /**
   * `listDrivers` (plan 2.4): the account's drivers the status, home site and cash-block filters
   * keep (SQL, RLS), their people on the platform pool, `q` matched in memory over the name and the
   * phone's last digits, then ordered and cut by the keyset in memory (the `name` sort is the
   * person's, which elx_app cannot read; PLAT-12 8.2 #21).
   */
  async list(request: DriverListRequest): Promise<ListPage<Driver>> {
    const rows = await new DriversRepository(getUnitOfWork()).matching({
      statuses: request.statuses,
      homeSiteId: request.homeSiteId,
      cashBlocked: request.cashBlocked,
    });
    const { q } = request;
    const drivers = (await this.driversOf(rows)).filter(
      ({ person }) => q === undefined || driverMatches(person, q),
    );
    const { plan } = request;
    const keyOf = (driver: Driver) => driverKeyOf(plan.sort.field, driver);
    return plan.page(keysetSlice(plan, drivers, keyOf), keyOf);
  }

  /** `getDriver`: a driver of the token's account in any state; another account's is `404`. */
  async get(id: string): Promise<Driver> {
    const row = await new DriversRepository(getUnitOfWork()).find(id);
    if (row === undefined) throw new ApiException('not_found');
    return this.driverOf(row);
  }

  /**
   * `createDriver` (plan 2.2, 2.3): the name, the phone and the home site checked; under the
   * account's driver write lock the `active` and `suspended` drivers counted against
   * `limits.drivers`; the person found or created by phone (platform pool); a phone that already
   * has a driver here is `400` at `/body/phone` (`duplicate`) unless that driver is archived, which
   * comes back; the `driver` role granted on the person's membership (role combination, PLAT-10);
   * the driver row, its audit row and the WhatsApp invitation in the tenant transaction.
   */
  async create(body: DriverCreate, facts: AuditFacts): Promise<Driver> {
    const { problems, phone } = personProblems(body);
    const site = await this.deps.identities.site(body.home_site_id);
    const siteRefusal = homeSiteRefusal(site);
    if (siteRefusal?.code === 'validation_failed')
      problems.push(...(siteRefusal.options.fields ?? []));
    if (problems.length > 0 || phone === undefined) {
      throw new ApiException('validation_failed', { fields: problems });
    }
    if (siteRefusal !== undefined) throw siteRefusal;

    const drivers = new DriversRepository(getUnitOfWork());
    await drivers.lockWrites();
    const account = await this.deps.identities.account();
    if ((await drivers.countCounted()) >= account.driversLimit) {
      throw new ApiException('limit_exceeded', {
        details: { metric: 'drivers', limit: account.driversLimit },
      });
    }
    const person = await this.deps.identities.personByPhone(phone, {
      name: body.name,
      locale: body.locale ?? account.defaultLocale,
    });
    const existing = await drivers.findOfUser(person.id);
    if (existing !== undefined && existing.status !== 'archived') {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/phone', code: 'duplicate' }],
      });
    }
    const membershipId = await this.deps.identities.grantDriverRole(person.id, body.home_site_id);
    const fields = {
      userId: person.id,
      membershipId,
      homeSiteId: body.home_site_id,
      capacityLimit: body.capacity_limit,
    };
    const row =
      existing === undefined
        ? await drivers.insert(uuidv7(), fields)
        : await drivers.reactivate(existing.id, fields);
    const driver: Driver = { row, person };
    await this.record(row, 'delivery.driver.created', undefined, auditFields(driver), facts);
    await this.invite(driver, body.locale ?? person.locale, account.name);
    this.#logger.log(`driver created driver_id=${row.id} phone=${phoneTail(phone)}`);
    return driver;
  }

  /**
   * `updateDriver` (plan 2.4): an absent field keeps its value; the name lives on the person; a new
   * home site passes the create's checks and moves a driver-only membership's `site_ids`; the
   * status follows active ⇄ suspended → archived (`409 invalid_transition` out of archived); the
   * capacity limit may not fall below the orders held (`422 capacity_exceeded`). A suspension ends
   * this membership's driver refresh families (the person's `token_version` stays, 8.2 #23); an
   * archive does that, revokes every device and clears every push token (data §10), and takes the
   * `driver` role off the membership. One audit row with the changed fields before and after;
   * nothing changed writes nothing.
   */
  async update(id: string, patch: DriverPatch, facts: AuditFacts): Promise<Driver> {
    if (patch.name !== undefined) {
      const problem = oneLineTextProblem('/body/name', patch.name, maxDriverNameLength);
      if (problem !== undefined) throw new ApiException('validation_failed', { fields: [problem] });
    }
    const uow = getUnitOfWork();
    const drivers = new DriversRepository(uow);
    await drivers.lockWrites();
    await drivers.lockDriver(id);
    const current = await drivers.find(id);
    if (current === undefined) throw new ApiException('not_found');
    const before = await this.driverOf(current);

    const status = patch.status ?? current.status;
    if (!statusChangeAllowed(current.status, status)) {
      throw new ApiException('invalid_transition', {
        details: { current_status: current.status, version: current.version },
      });
    }
    const homeSiteId = patch.home_site_id ?? current.homeSiteId;
    if (homeSiteId !== current.homeSiteId) {
      const refusal = homeSiteRefusal(await this.deps.identities.site(homeSiteId));
      if (refusal !== undefined) throw refusal;
    }
    const capacityLimit = patch.capacity_limit ?? current.capacityLimit;
    if (capacityLimit !== current.capacityLimit) {
      const refusal = capacityRefusal(capacityLimit, activeOrdersOf(current));
      if (refusal !== undefined) throw refusal;
    }
    const name = patch.name ?? before.person.name;

    const was = auditFields(before);
    const will: Record<string, unknown> = {
      ...was,
      name,
      home_site_id: homeSiteId,
      status,
      capacity_limit: capacityLimit,
    };
    const changed = Object.keys(will).filter((key) => was[key] !== will[key]);
    if (changed.length === 0) return before;

    // The platform side first (PLAT-12 8.2 #29): the request holds no lock it waits on.
    if (name !== before.person.name) await this.deps.identities.rename(current.userId, name);
    // Lead ruling 2026-11-02 (8.2 #12, #23): suspension and archive end this membership's driver
    // families only; the person's `token_version` stays, so their sessions elsewhere (another
    // account they drive for, a staff membership) live on. The refresh verdict refuses this
    // driver until they are `active` again.
    const ending = status !== current.status && status !== 'active';
    if (ending) {
      await this.deps.identities.endSessions(current.userId, current.membershipId, {
        bumpTokenVersion: false,
      });
    }

    if (status === 'archived' && current.status !== 'archived') {
      await new DriverDevicesRepository(uow).retireAll(current.id);
      await this.deps.identities.releaseDriverRole(current.membershipId);
    } else if (homeSiteId !== current.homeSiteId) {
      await this.deps.identities.moveHome(current.membershipId, homeSiteId);
    }
    const row = await drivers.update(id, { homeSiteId, status, capacityLimit });
    const after: Driver = { row, person: { ...before.person, name } };
    const now = auditFields(after);
    await this.record(
      row,
      'delivery.driver.updated',
      Object.fromEntries(changed.map((key) => [key, was[key]])),
      Object.fromEntries(changed.map((key) => [key, now[key]])),
      facts,
    );
    return after;
  }

  /** The WhatsApp app invitation (plan 2.3): a `message` row from the account's own sender. */
  private async invite(driver: Driver, locale: 'ar' | 'en', accountName: string): Promise<void> {
    const phone = driver.person.phone;
    if (phone === null) throw new Error('A driver person has no phone');
    const params = { account_name: accountName, app_link: this.deps.appUrl };
    const problem = templateParamsProblem('driver_invitation', params);
    // A fault of the stored account name (longer than the template takes), never of the request.
    if (problem !== undefined) throw new Error(`Driver invitation refused: ${problem}`);
    await this.deps.outbox.enqueue(getUnitOfWork(), {
      type: 'delivery.driver.created',
      version: 1,
      aggregate: { type: 'driver', id: driver.row.id, version: driver.row.version },
      kind: 'message',
      supersedeKey: `driver_invitation:${driver.row.id}`,
      payload: {
        channel: 'whatsapp',
        template_key: 'driver_invitation',
        to: phone,
        locale,
        params,
      },
    });
  }

  private async driversOf(rows: readonly DriverRow[]): Promise<Driver[]> {
    const people = await this.deps.identities.people(rows.map((row) => row.userId));
    return rows.map((row) => {
      const person = people.get(row.userId);
      // `del_drivers.user_id` references `core_users`; a missing person is no client's fault.
      if (person === undefined) throw new Error('The person of a driver has no row');
      return { row, person };
    });
  }

  private async driverOf(row: DriverRow): Promise<Driver> {
    const [driver] = await this.driversOf([row]);
    if (driver === undefined) throw new Error('A driver without its person');
    return driver;
  }

  private record(
    row: DriverRow,
    action: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    facts: AuditFacts,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'driver',
      targetId: row.id,
      action,
      ...(before === undefined ? {} : { before }),
      after,
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
  }
}
