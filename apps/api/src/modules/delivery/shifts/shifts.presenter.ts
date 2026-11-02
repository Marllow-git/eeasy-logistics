import type { DriverShift } from '@eeasy-logistics/contracts/staff/schemas';
import type { ShiftRow } from './shifts.repository.js';

/** `DriverShift` (components.yaml; domain model §3.6) from a row; one shape on both surfaces. */
export function presentShift(row: ShiftRow): DriverShift {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    driver_id: row.driverId,
    site_id: row.siteId,
    vehicle_id: row.vehicleId,
    planned_start: row.plannedStart.toISOString(),
    planned_end: row.plannedEnd.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    ended_at: row.endedAt?.toISOString() ?? null,
    status: row.status,
  };
}
