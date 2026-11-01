import type { OnApplicationShutdown } from '@nestjs/common';
import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { CheckName, ReadinessCheck } from './readiness.js';
import { failingChecks } from './readiness.js';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

/** Each check gets this long; a hung dependency makes `/ready` fail, never hang. */
export const readinessTimeoutMs = 2000;

/** A result is reused for this long, so a flood of probes cannot hold tenant connections. */
export const readinessCacheMs = 2000;

export interface ReadyBody {
  readonly status: 'ready';
}

export interface NotReadyBody {
  readonly status: 'not_ready';
  /** The names of the failing checks; no detail, ever (PLAT-5 plan 2.7). */
  readonly failing: readonly CheckName[];
}

/**
 * Readiness probe (platform §5): 200 when every check passes, 503 naming the failing ones. The
 * checks run at most once at a time and their result is cached for 2 s (review L-1).
 */
@Controller('ready')
export class ReadyController implements OnApplicationShutdown {
  private readonly logger = new Logger('Readiness');
  private inFlight: Promise<CheckName[]> | undefined;
  private cached: { readonly at: number; readonly failing: CheckName[] } | undefined;

  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  @Get()
  async check(): Promise<ReadyBody> {
    const failing = await this.evaluate();
    if (failing.length > 0) {
      const body: NotReadyBody = { status: 'not_ready', failing };
      throw new ServiceUnavailableException(body);
    }
    return { status: 'ready' };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.checks.map((check) => check.close?.() ?? Promise.resolve()));
  }

  private evaluate(): Promise<CheckName[]> {
    const now = Date.now();
    if (this.cached !== undefined && now - this.cached.at < readinessCacheMs) {
      return Promise.resolve(this.cached.failing);
    }
    this.inFlight ??= failingChecks(this.checks, readinessTimeoutMs)
      .then((failing) => {
        this.cached = { at: Date.now(), failing };
        if (failing.length > 0) this.logger.warn(`Not ready: ${failing.join(', ')}`);
        return failing;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}
