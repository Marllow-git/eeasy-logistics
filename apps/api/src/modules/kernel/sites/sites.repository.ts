import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { eq } from 'drizzle-orm';
import { coreSites } from '../schema/sites.js';

/** `core_sites` of the context's account (PLAT-12 plan 2.2, 2.5; ADR-0018). */
export class SitesRepository extends ScopedRepository<typeof coreSites> {
  constructor(uow: UnitOfWork) {
    super(uow, coreSites);
  }

  /** The account's active sites: `usage.sites` and the `limits.sites` check. */
  countActive(): Promise<number> {
    return this.countWhere(eq(coreSites.status, 'active'));
  }
}
