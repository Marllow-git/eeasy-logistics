import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import { effectiveLimits } from '../accounts/limits.js';
import type { AuditFacts } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { siteFilter } from '../authz/site-scope.js';
import type { ListPage, ListPagePlan } from '../contract/list-page.js';
import { ApiException } from '../errors/api-exception.js';
import { canonicalJson } from '../idempotency/request-hash.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import type { SiteKind, SiteStatus } from '../schema/sites.js';
import { coreSites } from '../schema/sites.js';
import type { LatLng, SiteBody } from './site-input.js';
import { siteFields } from './site-input.js';
import type { SiteRole, SiteUseChecks } from './site-use.js';
import { droppedRoles, siteRoles } from './site-use.js';
import type { SiteRow, SiteSortField } from './sites.repository.js';
import { SitesRepository, siteKeyOf } from './sites.repository.js';

// The site doors of the staff surface (PLAT-12 plan 2.5, 2.6, 2.12; ADR-0018; domain model K-4,
// K-5). Every write runs in the request's tenant unit of work under the account's site write lock,
// audits in that transaction (K-7) and, for a change Delivery and WMS cache, writes the outbox
// event `core.site.updated` (catalogue §6.3) there too. The site limit is read from the account
// row on the platform pool (elx_app may not lock it, review M-3); that read takes no lock, so it
// never waits on the request's own transaction.

/** A site's audited fields under the contract's names (before and after hold the changed ones). */
function auditFields(row: SiteRow): Record<string, unknown> {
  return {
    kind: row.kind,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    address_text: row.addressText,
    national_address_short_code: row.nationalAddressShortCode,
    point: latLngOf(row),
    opening_hours: row.openingHours,
  };
}

/** The stored point as `{ lat, lng }` (Drizzle's `xy`: `x` longitude, `y` latitude), or null. */
export function latLngOf(row: Pick<SiteRow, 'point'>): LatLng | null {
  return row.point === null ? null : { lat: row.point.y, lng: row.point.x };
}

export interface SiteListRequest {
  readonly plan: ListPagePlan<SiteSortField>;
  readonly statuses: readonly SiteStatus[] | undefined;
  readonly kind: SiteKind | undefined;
}

export class SitesService {
  constructor(
    private readonly deps: {
      readonly checks: SiteUseChecks;
      readonly accounts: AccountStore | null;
      readonly audit: AuditSink;
      readonly outbox: OutboxWriter;
    },
  ) {}

  /** `listSites`: a site-scoped principal sees its sites only (`siteFilter`, plan 2.5). */
  async list(request: SiteListRequest): Promise<ListPage<SiteRow>> {
    const { plan } = request;
    const rows = await new SitesRepository(getUnitOfWork()).page({
      statuses: request.statuses,
      kind: request.kind,
      scope: siteFilter(getContext(), coreSites.id),
      sort: plan.sort,
      after: plan.after,
      limit: plan.limit,
    });
    return plan.page(rows, (row) => siteKeyOf(plan.sort.field, row));
  }

  /** A site of the token's account; another account's id is `404` (the scope was checked). */
  async get(id: string): Promise<SiteRow> {
    const row = await new SitesRepository(getUnitOfWork()).find(id);
    if (row === undefined) throw new ApiException('not_found');
    return row;
  }

  /** `createSite`: under the write lock, refused at `limits.sites` active sites (plan 2.5). */
  async create(body: SiteBody, facts: AuditFacts): Promise<SiteRow> {
    const fields = siteFields(body);
    const sites = new SitesRepository(getUnitOfWork());
    await sites.lockWrites();
    await this.assertBelowLimit(sites);
    const row = await sites.insert(uuidv7(), fields);
    await this.record(row, 'core.site.created', undefined, auditFields(row), facts);
    return row;
  }

  /**
   * `updateSite` (plan 2.5): the whole editable site; a kind change runs the in-use checks of the
   * roles the site stops serving (`409 site_in_use`). A body equal to the site writes nothing.
   */
  async update(id: string, body: SiteBody, facts: AuditFacts): Promise<SiteRow> {
    const fields = siteFields(body);
    const sites = new SitesRepository(getUnitOfWork());
    await sites.lockWrites();
    const current = await this.get(id);
    await this.assertNotInUse(id, droppedRoles(current.kind, fields.kind));
    const was = auditFields(current);
    const will: Record<string, unknown> = {
      kind: fields.kind,
      name_ar: fields.nameAr,
      name_en: fields.nameEn,
      address_text: fields.addressText,
      national_address_short_code: fields.nationalAddressShortCode,
      point: fields.point,
      opening_hours: fields.openingHours,
    };
    const changed = Object.keys(will).filter(
      (key) => canonicalJson(was[key]) !== canonicalJson(will[key]),
    );
    if (changed.length === 0) return current;
    const row = await sites.update(id, fields);
    const after = auditFields(row);
    await this.record(
      row,
      'core.site.updated',
      Object.fromEntries(changed.map((key) => [key, was[key]])),
      Object.fromEntries(changed.map((key) => [key, after[key]])),
      facts,
    );
    await this.publish(row);
    return row;
  }

  /** `deactivateSite`: `active → inactive` unless a registered check holds the site (K-5). */
  async deactivate(id: string, facts: AuditFacts): Promise<SiteRow> {
    const sites = new SitesRepository(getUnitOfWork());
    await sites.lockWrites();
    const current = await this.get(id);
    assertStatus(current, 'active');
    await this.assertNotInUse(id, siteRoles(current.kind));
    return this.move(sites, current, 'inactive', 'core.site.deactivated', facts);
  }

  /** `activateSite`: `inactive → active`, within `limits.sites` like a create. */
  async activate(id: string, facts: AuditFacts): Promise<SiteRow> {
    const sites = new SitesRepository(getUnitOfWork());
    await sites.lockWrites();
    const current = await this.get(id);
    assertStatus(current, 'inactive');
    await this.assertBelowLimit(sites);
    return this.move(sites, current, 'active', 'core.site.activated', facts);
  }

  private async move(
    sites: SitesRepository,
    current: SiteRow,
    status: SiteStatus,
    action: string,
    facts: AuditFacts,
  ): Promise<SiteRow> {
    const row = await sites.setStatus(current.id, status);
    await this.record(row, action, { status: current.status }, { status }, facts);
    await this.publish(row);
    return row;
  }

  private async assertBelowLimit(sites: SitesRepository): Promise<void> {
    const store = this.deps.accounts;
    if (store === null) {
      new Logger('Sites').warn('DATABASE_URL_PLATFORM is not set: the site limit cannot be read');
      throw new ApiException('internal_error');
    }
    const accountId = getContext().accountId;
    const account = await store.run((accounts) => accounts.find(accountId));
    if (account === undefined) throw new Error('The account of the token has no row');
    const limit = effectiveLimits(account.limits).sites;
    if ((await sites.countActive()) >= limit) {
      throw new ApiException('limit_exceeded', { details: { metric: 'sites', limit } });
    }
  }

  private async assertNotInUse(id: string, roles: readonly SiteRole[]): Promise<void> {
    if (roles.length === 0) return;
    const reasons = await this.deps.checks.reasons(id, roles, getUnitOfWork());
    if (reasons.length > 0) throw new ApiException('site_in_use', { details: { reasons } });
  }

  private record(
    row: SiteRow,
    action: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    facts: AuditFacts,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      // `platformProvisionSite` (DEL-1 plan 2.6) creates through the cross-tenant door.
      actorType: context.actingCrossTenant ? 'platform_user' : 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'site',
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

  /** `core.site.updated` (catalogue §6.3: Delivery and WMS bust their site caches). */
  private async publish(row: SiteRow): Promise<void> {
    await this.deps.outbox.enqueue(getUnitOfWork(), {
      type: 'core.site.updated',
      version: 1,
      aggregate: { type: 'site', id: row.id, version: row.version },
      payload: { site_id: row.id, kind: row.kind, point: latLngOf(row) },
      kind: 'internal_event',
    });
  }
}

/** `409 invalid_transition` unless the site is in `from` (`details.current_status`, `version`). */
function assertStatus(row: SiteRow, from: SiteStatus): void {
  if (row.status !== from) {
    throw new ApiException('invalid_transition', {
      details: { current_status: row.status, version: row.version },
    });
  }
}
