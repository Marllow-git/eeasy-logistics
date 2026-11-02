import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { sql } from 'drizzle-orm';
import { coreAccounts } from '../modules/kernel/schema/accounts.js';
import { coreSites } from '../modules/kernel/schema/sites.js';
import { delCoverage, delZones } from '../modules/kernel/schema/zones.js';
import type { AccountFixture, CoverageFixture, SiteFixture, ZoneFixture } from './fixtures.js';

/** Writes fixture accounts across tenants (seed tool only; local and ci). */
export class FixtureAccountsRepository extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /** Inserts the accounts that do not exist yet; returns how many were inserted. */
  async insertMissing(accounts: readonly AccountFixture[]): Promise<number> {
    const inserted = await this.unscoped()
      .insert(coreAccounts)
      .values([...accounts])
      .onConflictDoNothing({ target: coreAccounts.id })
      .returning({ id: coreAccounts.id });
    return inserted.length;
  }

  /**
   * The fixture branches, zones and coverage that do not exist yet (DEL-1 plan 2.8); returns how
   * many rows were inserted. A point is written as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)`.
   */
  async insertMissingCoverage(fixtures: {
    readonly sites: readonly SiteFixture[];
    readonly zones: readonly ZoneFixture[];
    readonly coverage: readonly CoverageFixture[];
  }): Promise<number> {
    const tx = this.unscoped();
    const sites = await tx
      .insert(coreSites)
      .values(
        fixtures.sites.map(({ lng, lat, ...site }) => ({
          ...site,
          point: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)` as unknown as {
            x: number;
            y: number;
          },
        })),
      )
      .onConflictDoNothing({ target: coreSites.id })
      .returning({ id: coreSites.id });
    const zones = await tx
      .insert(delZones)
      .values([...fixtures.zones])
      .onConflictDoNothing({ target: delZones.id })
      .returning({ id: delZones.id });
    const coverage = await tx
      .insert(delCoverage)
      .values([...fixtures.coverage])
      .onConflictDoNothing({ target: delCoverage.id })
      .returning({ id: delCoverage.id });
    return sites.length + zones.length + coverage.length;
  }
}
