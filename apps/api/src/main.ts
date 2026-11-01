import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { RequestLogger } from './modules/kernel/request/request-id.js';
import { runMigrateJob } from './migrate/run.js';
import { parseRole } from './role.js';

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
    // No queue consumers, outbox relay or schedulers exist yet (platform §2); they arrive with later orders.
    const context = await NestFactory.createApplicationContext(AppModule);
    logger.log('Role: worker. No worker consumers are registered yet; exiting.');
    await context.close();
    return;
  }

  // Every log line written while serving a request names its request id (PLAT-6 plan 2.1).
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: new RequestLogger() });
  // SIGTERM and SIGINT run the shutdown hooks, which close the database pool (platform §5).
  app.enableShutdownHooks();
  await app.listen(config.app.port);
  logger.log(`Role: api. Environment: ${config.app.env}. Listening on port ${config.app.port}.`);
}

await bootstrap();
