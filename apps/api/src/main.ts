import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EX_CONFIG } from '@eeasy-logistics/config';
import { runMigrateJob } from './migrate/run.js';
import { parseRole } from './role.js';

// Static imports stop here: the migration job needs packages/config and packages/db only. The
// worker and the api load their Nest graphs lazily; the api's reaches the generated contracts
// (the audit controllers, PLAT-7), which CI builds only after it migrates. Dependency-cruiser rule
// `migrate-job-loads-no-application` keeps src/migrate/ off src/modules/ and the contracts.

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

  if (role === 'bootstrap') {
    // The first super admin's invitation (PLAT-11 plan 2.12): prints the accept link once; no
    // telemetry, no Nest graph. Exit 0 created, 1 refused (staff exist), 64 bad arguments.
    const { runBootstrap } = await import('./bootstrap.js');
    let code = 1;
    try {
      code = await runBootstrap(config, process.argv.slice(2), {
        log: (line) => process.stdout.write(`${line}\n`),
        error: (line) => logger.error(line),
      });
    } catch (error) {
      logger.error(`Bootstrap failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    process.exit(code);
  }

  // OpenTelemetry for the api and worker only (PLAT-14 plan 2.1), before Nest and ioredis load so
  // the loader hook sees them; the migration job above never loads it.
  const { serviceNames, startTelemetry } = await import('./modules/kernel/telemetry/sdk.js');
  startTelemetry(config, role, { loaderHook: true });
  // Sentry when SENTRY_DSN is set: exceptions only, scrubbed (plan 2.5).
  const { initSentry } = await import('./modules/kernel/telemetry/sentry.js');
  initSentry(config, role);
  // JSON lines through the telemetry redactor for every Nest logger from here on (plan 2.4).
  const { JsonLogger } = await import('./modules/kernel/telemetry/logger.js');
  const jsonLogger = new JsonLogger({
    service: serviceNames[role],
    release: config.observability.release,
    level: config.observability.logLevel,
  });
  Logger.overrideLogger(jsonLogger);

  const { NestFactory } = await import('@nestjs/core');

  if (role === 'worker') {
    // System jobs on timers until PLAT-8's queues: the hourly idempotency purge (PLAT-6 plan 2.9).
    // The platform pool's role is checked first; a mismatch exits 78 naming the role (plan 2.12).
    try {
      const { WorkerModule } = await import('./worker/system/worker.module.js');
      const worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
        abortOnError: false,
        logger: jsonLogger,
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

  const { AppModule } = await import('./app.module.js');
  const { BootChecks } = await import('./modules/kernel/platform/boot-checks.js');
  const { configureHttp, createHttpAdapter, httpAppOptions } = await import('./http-app.js');
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    createHttpAdapter(config),
    { ...httpAppOptions, logger: jsonLogger },
  );
  configureHttp(app);
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
