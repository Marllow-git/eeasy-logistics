import type { OnApplicationShutdown } from '@nestjs/common';
import { getMetrics, Public } from '../modules/kernel/public/index.js';
import { Controller, Get, HttpStatus, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
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
@Public()
@Controller('ready')
export class ReadyController implements OnApplicationShutdown {
  private readonly logger = new Logger('Readiness');
  private inFlight: Promise<CheckName[]> | undefined;
  private cached: { readonly at: number; readonly failing: CheckName[] } | undefined;

  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  // The 503 is set here, not thrown: a probe body is not the contract's `Error` schema, and the
  // global exception filter (PLAT-6) renders every thrown failure as `Error`.
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<ReadyBody | NotReadyBody> {
    const failing = await this.evaluate();
    if (failing.length > 0) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'not_ready', failing };
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
        // `ready_checks` per check, 1 passing and 0 failing (PLAT-14 plan 2.3).
        for (const check of this.checks) {
          getMetrics().set('ready_checks', failing.includes(check.name) ? 0 : 1, {
            check: check.name,
          });
        }
        return failing;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}
