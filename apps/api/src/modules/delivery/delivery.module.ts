import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import {
  driverIdentitiesProvider,
  driverSignInProvider,
  KernelModule,
} from '../kernel/public/index.js';
import { DRIVER_APP_URL } from './delivery.tokens.js';
import { DriverAuthController } from './driver-auth/driver-auth.controller.js';
import { DriversController } from './drivers/drivers.controller.js';
import { VehiclesController } from './vehicles/vehicles.controller.js';

/**
 * Delivery context (`del_` tables). Imports other contexts only from their `public/` (ADR-0026).
 * `DeliveryModule` alone registers nothing; `forRoot(config)` adds the doors that need the stack:
 * DEL-4's staff driver, device, PIN and vehicle doors (the kernel's audit sink and outbox writer
 * through `KernelModule`, the driver's person and membership through `DriverIdentities`) and the
 * driver's own doors (the code check and the tokens through the kernel's `DriverSignIn`).
 */
@Module({})
export class DeliveryModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: DeliveryModule,
      imports: [KernelModule],
      controllers: [DriversController, VehiclesController, DriverAuthController],
      providers: [
        driverIdentitiesProvider,
        driverSignInProvider(config),
        { provide: DRIVER_APP_URL, useValue: config.drivers.appUrl },
      ],
    };
  }
}
