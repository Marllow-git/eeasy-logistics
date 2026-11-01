import type { OnApplicationShutdown } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { shutdownTelemetry } from './sdk.js';
import { closeSentry } from './sentry.js';

/**
 * Flushes the spans, metrics, logs and error reports still buffered when the api or worker stops
 * (PLAT-14 plan 2.1, 2.5), at most 5 s and 2 s; a process without them has nothing to flush.
 */
@Injectable()
export class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([shutdownTelemetry(), closeSentry()]);
  }
}
