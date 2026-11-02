import type { Vehicle } from '@eeasy-logistics/contracts/staff/schemas';
import type { VehicleRow } from './vehicles.repository.js';

/** `Vehicle` (components.yaml; domain model §3.5) from a row. */
export function presentVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    plate: row.plate,
    kind: row.kind,
    capacity_parcels: row.capacityParcels,
    active: row.active,
  };
}
