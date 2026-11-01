// The configuration of the database tests: read through packages/config like every process
// (APP_ENV=local reads the root .env; ci passes variables). These tests need a real PostgreSQL
// (handbook 03: never a mock database); they use temporary tables only and leave nothing behind.
import type { Config } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import { readEnvironment } from '@eeasy-logistics/config/node';

export function testConfig(): Config {
  const config = defineConfig(readEnvironment());
  if (config.app.env !== 'local' && config.app.env !== 'ci') {
    throw new Error('Database tests run only with APP_ENV=local or APP_ENV=ci');
  }
  return config;
}
