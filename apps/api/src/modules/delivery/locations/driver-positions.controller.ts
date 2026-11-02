import type { DriverPositionList, DriverTrail } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type { ContractInput } from '../../kernel/public/index.js';
import { Feature, Input, Operation, SiteScoped } from '../../kernel/public/index.js';
import type { LocationFanout } from './location-fanout.js';
import { LOCATION_FANOUT } from './location-fanout.js';
import { LocationsService } from './locations.service.js';

// The staff surface's `driver-locations` tag (DEL-5 plan 2.7): `listLatestDriverPositions` (the
// polling twin of the dispatch stream) and `getDriverTrail`. `x-permission`
// `delivery.locations.read` is enforced by PLAT-10's guard. The latest list is `@SiteScoped()` on
// its `site_id` query and filtered to a site-scoped member's sites; the trail names a driver, not a
// site, and no role holding the permission is site-scoped (roles.yaml), so it carries no marker.
// The trail's M values (Unix seconds) stay server-side: the contract's `line` is the LineString.

const latestOp = operationSchemas.listLatestDriverPositions;
const trailOp = operationSchemas.getDriverTrail;

/** Today in Asia/Riyadh (`YYYY-MM-DD`): the trail's default business date. */
export function riyadhToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

@Feature('delivery')
@Controller('v1/staff')
export class DriverPositionsController {
  private readonly locations: LocationsService;

  constructor(@Optional() @Inject(LOCATION_FANOUT) fanout?: LocationFanout | null) {
    this.locations = new LocationsService({
      app: null,
      fanout: fanout ?? null,
      limiter: undefined,
    });
  }

  @Get('driver-locations/latest')
  @SiteScoped({ from: 'query', name: 'site_id' })
  @Operation(latestOp)
  async latest(@Input() input: ContractInput<typeof latestOp>): Promise<DriverPositionList> {
    const positions = await this.locations.latest(input.query.site_id);
    return {
      data: positions.map((position) => ({
        driver_id: position.driverId,
        point: { lat: position.lat, lng: position.lng },
        client_ts: position.clientTs,
        server_ts: position.serverTs,
        shift_status: position.shiftStatus,
      })),
    };
  }

  @Get('drivers/:driver_id/trail')
  @Operation(trailOp)
  async trail(@Input() input: ContractInput<typeof trailOp>): Promise<DriverTrail> {
    const trail = await this.locations.trail(
      input.params.driver_id,
      input.query.business_date ?? riyadhToday(),
    );
    return { driver_id: trail.driverId, business_date: trail.businessDate, line: trail.line };
  }
}
