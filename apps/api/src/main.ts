import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseRole } from './role.js';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const role = parseRole(process.argv.slice(2));
  // Read and validated once, before anything else starts; exits 78 naming every invalid variable.
  const config = loadConfig({ role });

  if (role === 'migrate') {
    // The one-shot migration job (data §11 step 5). Migrations and the migrator arrive with PLAT-5.
    logger.log('Role: migrate. No migrations yet (PLAT-5); exiting.');
    return;
  }

  if (role === 'worker') {
    // No queue consumers, outbox relay or schedulers exist yet (platform §2); they arrive with later orders.
    const context = await NestFactory.createApplicationContext(AppModule);
    logger.log('Role: worker. No worker consumers are registered yet; exiting.');
    await context.close();
    return;
  }

  const app = await NestFactory.create(AppModule);
  await app.listen(config.app.port);
  logger.log(`Role: api. Environment: ${config.app.env}. Listening on port ${config.app.port}.`);
}

await bootstrap();
