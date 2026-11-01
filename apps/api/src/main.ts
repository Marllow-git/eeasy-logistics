import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './http-app.js';
import { EX_CONFIG } from '@eeasy-logistics/config';
import { BootChecks } from './modules/kernel/platform/boot-checks.js';
import { RequestLogger } from './modules/kernel/request/request-id.js';
import { runMigrateJob } from './migrate/run.js';
import { parseRole } from './role.js';
import { WorkerModule } from './worker/system/worker.module.js';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const role = parseRole(process.argv.slice(2));
  // Read and validated once, before anything else starts; exits 78 naming every invalid variable.
  const config = loadConfig({ role });

  if (role === 'migrate') {
    // The one-shot job before the API starts (data §11.5); exit 0 also when nothing was pending.
    try {
      await runMigrateJob(config);
    } catch (error) {
      logger.error(`Migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exit(1);
    }
    return;
  }

  if (role === 'worker') {
    // System jobs on timers until PLAT-8's queues: the hourly idempotency purge (PLAT-6 plan 2.9).
    // The platform pool's role is checked first; a mismatch exits 78 naming the role (plan 2.12).
    try {
      const worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
        abortOnError: false,
        logger: new RequestLogger(),
      });
      // SIGTERM and SIGINT stop the timers and close the pool and the Redis client.
      worker.enableShutdownHooks();
    } catch (error) {
      logger.error(error instanceof Error ? error.message : 'Worker failed to start');
      process.exit(EX_CONFIG);
    }
    logger.log(`Role: worker. Environment: ${config.app.env}.`);
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: new RequestLogger(),
  });
  configureHttp(app, config);
  // Each configured pool must be its plain role before anything is served (PLAT-6 plan 2.12,
  // PLAT-5 ruling M-6); the refusal names the role, never the URL.
  try {
    await app.get(BootChecks).run();
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : 'Refusing to start: pool role check failed',
    );
    await app.close();
    process.exit(EX_CONFIG);
  }
  // SIGTERM and SIGINT run the shutdown hooks, which close the database pool (platform §5).
  app.enableShutdownHooks();
  await app.listen(config.app.port);
  logger.log(`Role: api. Environment: ${config.app.env}. Listening on port ${config.app.port}.`);
}

await bootstrap();
