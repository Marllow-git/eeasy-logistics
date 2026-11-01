import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Module } from '@nestjs/common';
import type { RunningWorker } from './worker.js';
import { startWorker } from './worker.js';

const RUNNING_WORKER = Symbol('RUNNING_WORKER');

/** Hosts the worker in a Nest application context, so shutdown hooks stop its timers and pools. */
@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(RUNNING_WORKER) private readonly worker: RunningWorker) {}

  static forRoot(config: Config): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: RUNNING_WORKER, useFactory: () => startWorker(config) }],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.stop();
  }
}
