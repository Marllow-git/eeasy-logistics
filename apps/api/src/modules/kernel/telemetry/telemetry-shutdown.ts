import type { OnApplicationShutdown } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { shutdownTelemetry } from './sdk.js';

/**
 * Flushes the spans, metrics and logs still buffered when the api or worker stops (PLAT-14 plan
 * 2.1), at most 5 s; a process without telemetry has nothing to flush.
 */
@Injectable()
export class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
