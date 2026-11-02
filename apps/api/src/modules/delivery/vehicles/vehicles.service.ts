import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { AuditSink, ListPage, ListPagePlan } from '../../kernel/public/index.js';
import { ApiException } from '../../kernel/public/index.js';
import type { AuditFacts } from '../drivers/drivers.service.js';
import type { VehicleBody } from './vehicle-input.js';
import { createProblems, normalisePlate, plateProblem } from './vehicle-input.js';
import type { VehicleFields, VehicleRow, VehicleSortField } from './vehicles.repository.js';
import { VehiclesRepository, vehicleKeyOf } from './vehicles.repository.js';

// The vehicle doors of the staff surface (DEL-4 plan 2.6; domain model §3.5). The account is the
// token's; every write runs in the request's tenant unit of work under the account's vehicle write
// lock (the plate's uniqueness check and the write agree), `version + 1`, audited in that
// transaction.

function auditFields(row: VehicleRow): Record<string, unknown> {
  return {
    plate: row.plate,
    kind: row.kind,
    capacity_parcels: row.capacityParcels,
    active: row.active,
  };
}

const duplicatePlate = () =>
  new ApiException('validation_failed', {
    fields: [{ pointer: '/body/plate', code: 'duplicate' }],
  });

export class VehiclesService {
  constructor(private readonly deps: { readonly audit: AuditSink }) {}

  /** `listVehicles`: the `active` filter, sorted by plate (default) or creation time. */
  async list(request: {
    readonly plan: ListPagePlan<VehicleSortField>;
    readonly active: boolean | undefined;
  }): Promise<ListPage<VehicleRow>> {
    const { plan } = request;
    const rows = await new VehiclesRepository(getUnitOfWork()).page({
      active: request.active,
      sort: plan.sort,
      after: plan.after,
      limit: plan.limit,
    });
    return plan.page(rows, (row) => vehicleKeyOf(plan.sort.field, row));
  }

  /** `createVehicle`: plate, kind and capacity required; the plate unique per account. */
  async create(body: VehicleBody, facts: AuditFacts): Promise<VehicleRow> {
    const problems = createProblems(body);
    if (
      problems.length > 0 ||
      body.plate === undefined ||
      body.kind === undefined ||
      body.capacity_parcels === undefined
    ) {
      throw new ApiException('validation_failed', { fields: problems });
    }
    const fields: VehicleFields = {
      plate: normalisePlate(body.plate),
      kind: body.kind,
      capacityParcels: body.capacity_parcels,
      active: body.active ?? true,
    };
    const vehicles = new VehiclesRepository(getUnitOfWork());
    await vehicles.lockWrites();
    if (await vehicles.plateTaken(fields.plate)) throw duplicatePlate();
    const row = await vehicles.insert(uuidv7(), fields);
    await this.record(row, 'delivery.vehicle.created', undefined, auditFields(row), facts);
    return row;
  }

  /**
   * `updateVehicle`: an absent field keeps its value; a new plate is normalised and stays unique.
   * A body that changes nothing writes nothing. Another account's vehicle is `404`.
   */
  async update(id: string, body: VehicleBody, facts: AuditFacts): Promise<VehicleRow> {
    if (body.plate !== undefined) {
      const problem = plateProblem(body.plate);
      if (problem !== undefined) throw new ApiException('validation_failed', { fields: [problem] });
    }
    const vehicles = new VehiclesRepository(getUnitOfWork());
    await vehicles.lockWrites();
    const current = await vehicles.find(id);
    if (current === undefined) throw new ApiException('not_found');
    const plate = body.plate === undefined ? current.plate : normalisePlate(body.plate);
    if (plate !== current.plate && (await vehicles.plateTaken(plate, id))) throw duplicatePlate();
    const was = auditFields(current);
    const will: Record<string, unknown> = {
      plate,
      kind: body.kind ?? current.kind,
      capacity_parcels: body.capacity_parcels ?? current.capacityParcels,
      active: body.active ?? current.active,
    };
    const changed = Object.keys(will).filter((key) => was[key] !== will[key]);
    if (changed.length === 0) return current;
    const row = await vehicles.update(id, {
      plate,
      kind: body.kind ?? current.kind,
      capacityParcels: body.capacity_parcels ?? current.capacityParcels,
      active: body.active ?? current.active,
    });
    await this.record(
      row,
      'delivery.vehicle.updated',
      Object.fromEntries(changed.map((key) => [key, was[key]])),
      Object.fromEntries(changed.map((key) => [key, will[key]])),
      facts,
    );
    return row;
  }

  private record(
    row: VehicleRow,
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
      targetType: 'vehicle',
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
