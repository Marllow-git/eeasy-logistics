import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { CheckName, ReadinessCheck } from './readiness.js';
import { failingChecks } from './readiness.js';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

/** Each check gets this long; a hung dependency makes `/ready` fail, never hang. */
export const readinessTimeoutMs = 2000;

export interface ReadyBody {
  readonly status: 'ready';
}

export interface NotReadyBody {
  readonly status: 'not_ready';
  /** The names of the failing checks; no detail, ever (PLAT-5 plan 2.7). */
  readonly failing: readonly CheckName[];
}

/** Readiness probe (platform §5): 200 when every check passes, 503 naming the failing ones. */
@Controller('ready')
export class ReadyController {
  private readonly logger = new Logger('Readiness');

  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  @Get()
  async check(): Promise<ReadyBody> {
    const failing = await failingChecks(this.checks, readinessTimeoutMs);
    if (failing.length > 0) {
      this.logger.warn(`Not ready: ${failing.join(', ')}`);
      const body: NotReadyBody = { status: 'not_ready', failing };
      throw new ServiceUnavailableException(body);
    }
    return { status: 'ready' };
  }
}
