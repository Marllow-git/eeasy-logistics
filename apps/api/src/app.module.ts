import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { ReadinessModule } from './health/readiness.module.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { KernelModule } from './modules/kernel/kernel.module.js';
import { WmsModule } from './modules/wms/wms.module.js';

/**
 * The application. `AppModule` alone has no dependency on the stack (liveness, the contexts);
 * `AppModule.forRoot(config)` adds the database pool and `/ready`, and is what `main.ts` starts.
 */
@Module({
  imports: [KernelModule, DeliveryModule, WmsModule],
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return { module: AppModule, imports: [ReadinessModule.forRoot(config)] };
  }
}
