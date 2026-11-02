import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import type {
  AuditSink,
  FieldProblem,
  ListPage,
  ListPagePlan,
  SiteSummary,
} from '../../kernel/public/index.js';
import { ApiException, siteSummaries } from '../../kernel/public/index.js';
import type { AuditFacts } from '../drivers/drivers.service.js';
import type { CoverageRow, CoverageSortField } from './coverage.repository.js';
import { CoverageRepository, coverageKeyOf } from './coverage.repository.js';
import { ZonesRepository } from './zones.repository.js';

// The coverage doors (DEL-1 plan 2.4, 2.6, 2.7; ADR-0015; K-4). A site's zones are replaced as a
// set under the account's coverage lock (`<account>/del_coverage`), audited with the zone ids
// before and after. Only an active `branch` or `both` site covers zones (a warehouse delivers
// nothing: `422 site_kind_mismatch`).

/** One site's new set: `site_id` and its zones, duplicates collapsed. */
export interface CoverageEntry {
  readonly siteId: string;
  readonly zoneIds: readonly string[];
}

/** How an unknown site or zone is answered: the staff door's 400 per zone, the platform's 404. */
export type UnknownReference = 'field' | 'not_found';

/** `site_kind_mismatch` for a warehouse, `invalid_transition` for an inactive site. */
export function coveringSiteRefusal(site: SiteSummary): ApiException | undefined {
  if (site.kind === 'warehouse') {
    return new ApiException('site_kind_mismatch', {
      details: { site_id: site.id, kind: site.kind },
    });
  }
  if (site.status !== 'active') {
    return new ApiException('invalid_transition', {
      details: { site_id: site.id, current_status: site.status },
    });
  }
  return undefined;
}

export class CoverageService {
  constructor(private readonly deps: { readonly audit: AuditSink }) {}

  /** `listCoverage`: the `site_id` filter and the principal's site scope. */
  async list(request: {
    readonly plan: ListPagePlan<CoverageSortField>;
    readonly siteId: string | undefined;
    readonly scope: SQL | undefined;
  }): Promise<ListPage<CoverageRow>> {
    const { plan } = request;
    const rows = await new CoverageRepository(getUnitOfWork()).page({
      siteId: request.siteId,
      scope: request.scope,
      sort: plan.sort,
      after: plan.after,
      limit: plan.limit,
    });
    return plan.page(rows, coverageKeyOf);
  }

  /** Every coverage row of the account (`platformProvisionCoverage`'s answer). */
  all(): Promise<CoverageRow[]> {
    return new CoverageRepository(getUnitOfWork()).all();
  }

  /**
   * Replaces each entry's set in the request's unit of work (plan 2.4, 2.6): every site must be the
   * account's (`404`), an active branch or both; every zone the account's (`unknown` says how a
   * foreign one is answered). Returns each entry's zones as stored.
   */
  async replace(
    entries: readonly CoverageEntry[],
    unknown: UnknownReference,
    facts: AuditFacts,
  ): Promise<{ siteId: string; zoneIds: string[] }[]> {
    const uow = getUnitOfWork();
    const sets = entries.map((entry) => ({
      siteId: entry.siteId,
      zoneIds: [...new Set(entry.zoneIds)].sort(),
    }));
    const sites = new Map(
      (await siteSummaries(uow, [...new Set(sets.map((set) => set.siteId))])).map((site) => [
        site.id,
        site,
      ]),
    );
    for (const set of sets) {
      const site = sites.get(set.siteId);
      if (site === undefined) throw new ApiException('not_found');
      const refusal = coveringSiteRefusal(site);
      if (refusal !== undefined) throw refusal;
    }
    const known = await new ZonesRepository(uow).existing(sets.flatMap((set) => set.zoneIds));
    for (const [index, entry] of entries.entries()) {
      const problems: FieldProblem[] = [];
      entry.zoneIds.forEach((zoneId, i) => {
        if (!known.has(zoneId))
          problems.push({ pointer: zonePointer(unknown, index, i), code: 'invalid' });
      });
      if (problems.length === 0) continue;
      if (unknown === 'not_found') throw new ApiException('not_found');
      throw new ApiException('validation_failed', { fields: problems });
    }
    const coverage = new CoverageRepository(uow);
    await coverage.lockWrites();
    const stored: { siteId: string; zoneIds: string[] }[] = [];
    for (const set of sets) {
      const before = await coverage.zonesOf(set.siteId);
      if (before.join() !== set.zoneIds.join()) {
        await coverage.replace(set.siteId, set.zoneIds);
        await this.record(set.siteId, before, set.zoneIds, facts);
      }
      stored.push(set);
    }
    return stored;
  }

  private record(
    siteId: string,
    before: readonly string[],
    after: readonly string[],
    facts: AuditFacts,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: context.actingCrossTenant ? 'platform_user' : 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'site',
      targetId: siteId,
      action: 'delivery.coverage.replaced',
      before: { zone_ids: before },
      after: { zone_ids: after },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
  }
}

const zonePointer = (unknown: UnknownReference, entry: number, zone: number) =>
  unknown === 'field' ? `/body/zone_ids/${zone}` : `/body/entries/${entry}/zone_ids/${zone}`;
