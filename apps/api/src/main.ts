import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseRole } from './role.js';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const role = parseRole(process.argv.slice(2));

  if (role === 'worker') {
    // No queue consumers, outbox relay or schedulers exist yet (platform §2); they arrive with later orders.
    const context = await NestFactory.createApplicationContext(AppModule);
    logger.log('Role: worker. No worker consumers are registered yet; exiting.');
    await context.close();
    return;
  }

  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000; // PLAT-4 replaces: the config module will own PORT.
  await app.listen(port);
  logger.log(`Role: api. Listening on port ${port}.`);
}

await bootstrap();
