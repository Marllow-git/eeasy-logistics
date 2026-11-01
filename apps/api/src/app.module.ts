import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessModule } from './health/readiness.module.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { KernelModule } from './modules/kernel/kernel.module.js';
import { MessagingModule } from './modules/kernel/messaging/messaging.module.js';
import { RequestFrameModule } from './modules/kernel/request-frame.module.js';
import { TelemetryShutdown } from './modules/kernel/telemetry/telemetry-shutdown.js';
import { WmsModule } from './modules/wms/wms.module.js';

/**
 * The application. `AppModule` alone has no dependency on the stack (liveness, the contexts, the
 * request frame refusing every non-public route); `AppModule.forRoot(config)` adds the database
 * pools, the signing key and `/ready`, and is what `main.ts` starts.
 */
@Module({
  imports: [KernelModule, DeliveryModule, WmsModule],
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config),
        RequestFrameModule.forRoot(config),
        // PLAT-9: the OTP service of the sign-in doors and the messaging availability.
        MessagingModule.forRoot(config),
        ReadinessModule.forRoot(config),
      ],
      // PLAT-14: flushes the telemetry main.ts started.
      providers: [TelemetryShutdown],
    };
  }
}
