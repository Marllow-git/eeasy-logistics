import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { Controller, HttpCode, Inject, Optional, Post } from '@nestjs/common';
import { APP_POOL } from '../../../database/database.module.js';
import type { ContractInput, RateLimiter } from '../../kernel/public/index.js';
import {
  Feature,
  Input,
  NoUnitOfWork,
  Operation,
  RATE_LIMITER,
} from '../../kernel/public/index.js';
import { ReplayRoute } from '../driver-auth/app-version.guard.js';
import type { LocationFanout } from './location-fanout.js';
import { LOCATION_FANOUT } from './location-fanout.js';
import { LocationsService } from './locations.service.js';

// `driverPostLocations` (DEL-5 plan 2.6; domain model §7; ADR-0009, ADR-0028; driver app §6.2):
// `202` for a batch of 1 to 20 points, no idempotency key (a duplicate point is harmless), no
// outbox row. `x-permission` `delivery.driver.locations` is enforced by PLAT-10's guard; the route
// budget of README §7 counts per device, the service's `driver_locations` budget per driver. The
// app's background task sends queued points from any version, so the door never answers `426`
// (`@ReplayRoute()`; contracts REVIEW N6; adversary round 1, L-c).

const postOp = operationSchemas.driverPostLocations;

// The `delivery` module's feature gate (DEL-5 adversary round 1, finding 2; ADR-0006): `403
// feature_not_enabled` for an account the module is not visible to (K-6). DEL-4's driver-auth doors
// stay ungated: a driver must sign in to learn the module is off.
@Feature('delivery')
@Controller('v1/driver/locations')
export class DriverLocationsController {
  private readonly locations: LocationsService;

  constructor(
    @Optional() @Inject(APP_POOL) app?: Pool<AppDatabase> | null,
    @Optional() @Inject(LOCATION_FANOUT) fanout?: LocationFanout | null,
    @Optional() @Inject(RATE_LIMITER) limiter?: RateLimiter,
  ) {
    this.locations = new LocationsService({
      app: app?.db ?? null,
      fanout: fanout ?? null,
      limiter,
    });
  }

  /** No request unit of work: the ingest opens the request's only app transaction (H-1). */
  @Post()
  @HttpCode(202)
  @ReplayRoute()
  @NoUnitOfWork()
  @Operation(postOp)
  async post(@Input() input: ContractInput<typeof postOp>): Promise<void> {
    await this.locations.ingest(input.body.points ?? []);
  }
}
