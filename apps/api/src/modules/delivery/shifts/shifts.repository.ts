import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, eq, inArray } from 'drizzle-orm';
import { delDriverShifts, liveShiftStatuses } from '../../kernel/public/index.js';

/** A `del_driver_shifts` row of the context's account. */
export type ShiftRow = typeof delDriverShifts.$inferSelect;

const live = inArray(delDriverShifts.status, [...liveShiftStatuses]);

/** `del_driver_shifts` of the context's account in the caller's tenant unit of work (DEL-5 2.1). */
export class ShiftsRepository extends ScopedRepository<typeof delDriverShifts> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverShifts);
  }

  /** The driver's live (`active` or `paused`) shift; at most one by the partial unique index. */
  async live(driverId: string): Promise<ShiftRow | undefined> {
    const [row] = await this.findMany(and(eq(delDriverShifts.driverId, driverId), live), {
      limit: 1,
    });
    return row;
  }
}
