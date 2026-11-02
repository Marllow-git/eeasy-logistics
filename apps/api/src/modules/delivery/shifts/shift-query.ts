import type { UnitOfWork } from '@eeasy-logistics/db';
import type { ShiftStatus } from '../../kernel/public/index.js';
import { ShiftsRepository } from './shifts.repository.js';

// `ShiftQuery` (DEL-5 plan 2.2; domain model §3.18 D-6, D-12): the driver's live shift in the
// caller's own unit of work, for DEL-6's offers (only to a driver on an `active` shift with a
// vehicle) and DEL-7's driver transitions (only during an `active` or `paused` shift).

export interface LiveShift {
  readonly id: string;
  readonly status: Extract<ShiftStatus, 'active' | 'paused'>;
  readonly siteId: string;
  readonly vehicleId: string | null;
}

export const ShiftQuery = {
  /** The driver's `active` or `paused` shift of the unit of work's account, or undefined. */
  async live(uow: UnitOfWork, driverId: string): Promise<LiveShift | undefined> {
    const row = await new ShiftsRepository(uow).live(driverId);
    if (row === undefined) return undefined;
    if (row.status !== 'active' && row.status !== 'paused') return undefined;
    return { id: row.id, status: row.status, siteId: row.siteId, vehicleId: row.vehicleId };
  },
} as const;
