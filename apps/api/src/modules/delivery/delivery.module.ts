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
import { VehiclesController } from './vehicles/vehicles.controller.js';
import { CoverageController } from './zones/coverage.controller.js';
import { ZonesController } from './zones/zones.controller.js';

/**
 * Delivery context (`del_` tables). Imports other contexts only from their `public/` (ADR-0026).
 * `DeliveryModule` alone registers nothing; `forRoot(config)` adds the doors that need the stack:
 * DEL-4's staff driver, device, PIN and vehicle doors (the kernel's audit sink and outbox writer
 * through `KernelModule`, the driver's person and membership through `DriverIdentities`) and the
 * driver's own doors (the code check and the tokens through the kernel's `DriverSignIn`); DEL-1's
 * zone and coverage doors.
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
        { provide: DRIVER_APP_URL, useValue: config.drivers.appUrl },
        { provide: DRIVER_MIN_APP_VERSION, useValue: config.drivers.minAppVersion },
        // Every `v1/driver/*` route but the `@ReplayRoute()` ones (plan 2.10).
        { provide: APP_GUARD, useClass: AppVersionGuard },
      ],
    };
  }
}
