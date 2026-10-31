import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { KernelModule } from './modules/kernel/kernel.module.js';
import { WmsModule } from './modules/wms/wms.module.js';

@Module({
  imports: [KernelModule, DeliveryModule, WmsModule],
  controllers: [HealthController],
})
export class AppModule {}
