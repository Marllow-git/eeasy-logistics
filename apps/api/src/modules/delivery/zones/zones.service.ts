import type { MultiPolygonGeoJson } from '@eeasy-logistics/db';
import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { AuditSink, FieldProblem, ListPage, ListPagePlan } from '../../kernel/public/index.js';
import { ApiException } from '../../kernel/public/index.js';
import type { AuditFacts } from '../drivers/drivers.service.js';
import type { ZoneBody, ZoneBoundary } from './zone-input.js';
import {
  isFieldProblem,
  maxZonesPerAccount,
  newZone,
  normaliseZoneName,
  zoneBoundary,
  zoneNameProblem,
} from './zone-input.js';
import type { ListedZone, ZoneRow, ZoneSortField } from './zones.repository.js';
import { ZonesRepository, zoneKeyOf } from './zones.repository.js';

// The zone doors (DEL-1 plan 2.2, 2.3, 2.7; domain model §3.4; data §8). The account is the
// token's, or the cross-tenant door's for `platformProvisionZone` (the platform user is then the
// audit actor). Every write runs in the request's unit of work under the account's zone write
// lock (`<account>/del_zones`): the 200-zone count and the insert agree. A boundary is checked
// against the bounds in code, then `ST_IsValid` in SQL, before it is written; the audit rows
// record its polygon and position counts, never the geometry.

const validationFailed = (problems: readonly FieldProblem[]) =>
  new ApiException('validation_failed', { fields: problems });

/** What the audit row records of a boundary (plan 2.3). */
function boundaryFacts(geometry: MultiPolygonGeoJson): { polygons: number; positions: number } {
  return {
    polygons: geometry.coordinates.length,
    positions: geometry.coordinates.flat().reduce((sum, ring) => sum + ring.length, 0),
  };
}

function auditFields(row: ZoneRow): Record<string, unknown> {
  return {
    name_ar: row.nameAr,
    name_en: row.nameEn,
    source: row.source,
    active: row.active,
    boundary: boundaryFacts(row.boundary),
  };
}

export class ZonesService {
  constructor(private readonly deps: { readonly audit: AuditSink }) {}

  /** `listZones`: the `active` filter and `q` over both names; no boundaries (plan 2.3). */
  async list(request: {
    readonly plan: ListPagePlan<ZoneSortField>;
    readonly active: boolean | undefined;
    readonly q: string | undefined;
  }): Promise<ListPage<ListedZone>> {
    const { plan } = request;
    const rows = await new ZonesRepository(getUnitOfWork()).page({
      active: request.active,
      q: request.q,
      sort: plan.sort,
      after: plan.after,
      limit: plan.limit,
    });
    return plan.page(rows, (row) => zoneKeyOf(plan.sort.field, row));
  }

  /** `getZone`: with its boundary; another account's zone is `404`. */
  async get(id: string): Promise<ZoneRow> {
    const row = await new ZonesRepository(getUnitOfWork()).find(id);
    if (row === undefined) throw new ApiException('not_found');
    return row;
  }

  /**
   * `createZone` and `platformProvisionZone` (plan 2.2, 2.6): names, boundary and source required;
   * the 201st zone of an account is `422 limit_exceeded`.
   */
  async create(body: ZoneBody, facts: AuditFacts): Promise<ZoneRow> {
    const fields = newZone(body);
    if (Array.isArray(fields)) throw validationFailed(fields);
    const zones = new ZonesRepository(getUnitOfWork());
    await assertValid(zones, fields.boundary);
    await zones.lockWrites();
    if ((await zones.count()) >= maxZonesPerAccount) {
      throw new ApiException('limit_exceeded', {
        details: { metric: 'zones', limit: maxZonesPerAccount },
      });
    }
    const row = await zones.insert(uuidv7(), {
      nameAr: fields.nameAr,
      nameEn: fields.nameEn,
      boundary: fields.boundary.geometry,
      source: fields.source,
      active: fields.active,
    });
    await this.record(row, 'delivery.zone.created', undefined, auditFields(row), facts);
    return row;
  }

  /**
   * `updateZone` (plan 2.3): a PATCH of the sent fields (names, boundary, active; `source` stays);
   * a body that changes nothing writes nothing. Deactivating keeps the zone's coverage rows; the
   * check ignores an inactive zone.
   */
  async update(id: string, body: ZoneBody, facts: AuditFacts): Promise<ZoneRow> {
    const problems: FieldProblem[] = [];
    for (const key of ['name_ar', 'name_en'] as const) {
      if (body[key] !== undefined) {
        const problem = zoneNameProblem(`/body/${key}`, body[key]);
        if (problem !== undefined) problems.push(problem);
      }
    }
    let boundary: ZoneBoundary | undefined;
    if (body.boundary !== undefined) {
      const checked = zoneBoundary(body.boundary);
      if (isFieldProblem(checked)) problems.push(checked);
      else boundary = checked;
    }
    if (problems.length > 0) throw validationFailed(problems);
    const zones = new ZonesRepository(getUnitOfWork());
    if (boundary !== undefined) await assertValid(zones, boundary);
    await zones.lockWrites();
    const current = await zones.find(id);
    if (current === undefined) throw new ApiException('not_found');
    const nameAr = body.name_ar === undefined ? current.nameAr : normaliseZoneName(body.name_ar);
    const nameEn = body.name_en === undefined ? current.nameEn : normaliseZoneName(body.name_en);
    const geometry = boundary?.geometry ?? current.boundary;
    const active = body.active ?? current.active;
    const was = auditFields(current);
    const will: Record<string, unknown> = {
      name_ar: nameAr,
      name_en: nameEn,
      source: current.source,
      active,
      boundary: boundaryFacts(geometry),
    };
    const boundaryChanged = JSON.stringify(geometry) !== JSON.stringify(current.boundary);
    const changed = Object.keys(will).filter((key) =>
      key === 'boundary' ? boundaryChanged : was[key] !== will[key],
    );
    if (changed.length === 0) return current;
    const row = await zones.update(id, {
      nameAr,
      nameEn,
      active,
      ...(boundaryChanged ? { boundary: geometry } : {}),
    });
    await this.record(
      row,
      'delivery.zone.updated',
      Object.fromEntries(changed.map((key) => [key, was[key]])),
      Object.fromEntries(changed.map((key) => [key, will[key]])),
      facts,
    );
    return row;
  }

  private record(
    row: ZoneRow,
    action: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    facts: AuditFacts,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: context.actingCrossTenant ? 'platform_user' : 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'zone',
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

/** `400 validation_failed` at `/body/boundary` with PostGIS's reason when it is not valid. */
async function assertValid(zones: ZonesRepository, boundary: ZoneBoundary): Promise<void> {
  const reason = await zones.invalidReason(boundary.geometry);
  if (reason !== null) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/body/boundary', code: 'invalid' }],
      details: { reason },
    });
  }
}
