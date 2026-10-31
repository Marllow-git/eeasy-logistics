import { Module } from '@nestjs/common';

/** Shared kernel context (`core_` tables). Imports no other context (ADR-0026). */
@Module({})
export class KernelModule {}
