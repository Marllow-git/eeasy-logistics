import type { Config } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_POOL } from '../../database/database.module.js';
import type { AuditSink } from '../kernel/public/index.js';
import {
  AUDIT_SINK,
  driverIdentitiesProvider,
  driverSignInProvider,
  KernelModule,
  PasswordHasher,
} from '../kernel/public/index.js';
import { DRIVER_APP_URL, DRIVER_MIN_APP_VERSION } from './delivery.tokens.js';
import { AppVersionGuard } from './driver-auth/app-version.guard.js';
import { DriverAuthController } from './driver-auth/driver-auth.controller.js';
import { PinCheck } from './drivers/cash-pin.js';
import { DriverCashPinController } from './drivers/driver-cash-pin.controller.js';
import { DriversController } from './drivers/drivers.controller.js';
import { DriverLocationsController } from './locations/driver-locations.controller.js';
import { DriverPositionsController } from './locations/driver-positions.controller.js';
import { LOCATION_FANOUT, RedisLocationFanout } from './locations/location-fanout.js';
import { DriverShiftsController } from './shifts/driver-shifts.controller.js';
import { ShiftsController } from './shifts/shifts.controller.js';
import { VehiclesController } from './vehicles/vehicles.controller.js';
import { CoverageController } from './zones/coverage.controller.js';
import { PlatformZonesController } from './zones/platform-zones.controller.js';
import { ZonesController } from './zones/zones.controller.js';

/**
 * Delivery context (`del_` tables). Imports other contexts only from their `public/` (ADR-0026).
 * `DeliveryModule` alone registers nothing; `forRoot(config)` adds the doors that need the stack:
 * DEL-4's staff driver, device, PIN and vehicle doors (the kernel's audit sink and outbox writer
 * through `KernelModule`, the driver's person and membership through `DriverIdentities`) and the
 * driver's own doors (the code check and the tokens through the kernel's `DriverSignIn`); DEL-1's
 * zone, coverage and coverage check doors and the platform's zone and coverage provisioning doors;
 * DEL-5's staff and driver shift doors, the location ingest and the staff position reads.
 */
@Module({})
export class DeliveryModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: DeliveryModule,
      imports: [KernelModule],
      controllers: [
        DriversController,
        VehiclesController,
        DriverAuthController,
        DriverCashPinController,
        ZonesController,
        CoverageController,
        PlatformZonesController,
        ShiftsController,
        DriverShiftsController,
        DriverLocationsController,
        DriverPositionsController,
      ],
      providers: [
        driverIdentitiesProvider,
        driverSignInProvider(config),
        {
          // The cash PIN check (plan 2.9): its own tenant transaction on the app pool per check.
          provide: PinCheck,
          inject: [{ token: APP_POOL, optional: true }, AUDIT_SINK],
          useFactory: (app: Pool<AppDatabase> | null | undefined, audit: AuditSink) =>
            new PinCheck({ app: app?.db ?? null, hasher: new PasswordHasher(), audit }),
        },
        {
          // The latest positions and the per-account channel (DEL-5 plan 2.6): its own Redis
          // connection, closed on shutdown; without REDIS_URL none, and the head rows serve the maps.
          provide: LOCATION_FANOUT,
          useFactory: () => {
            const url = config.redis.url;
            return url === undefined ? null : new RedisLocationFanout(url.reveal());
          },
        },
        { provide: DRIVER_APP_URL, useValue: config.drivers.appUrl },
        { provide: DRIVER_MIN_APP_VERSION, useValue: config.drivers.minAppVersion },
        // Every `v1/driver/*` route but the `@ReplayRoute()` ones (plan 2.10).
        { provide: APP_GUARD, useClass: AppVersionGuard },
      ],
    };
  }
}
