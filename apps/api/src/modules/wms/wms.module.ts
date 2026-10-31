import { Module } from '@nestjs/common';

/** WMS context (`wms_` tables). Imports other contexts only from their `public/` (ADR-0026). */
@Module({})
export class WmsModule {}
