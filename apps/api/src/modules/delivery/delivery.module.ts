import { Module } from '@nestjs/common';

/** Delivery context (`del_` tables). Imports other contexts only from their `public/` (ADR-0026). */
@Module({})
export class DeliveryModule {}
