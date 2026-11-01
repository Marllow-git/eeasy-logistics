// `pnpm --filter api seed [--template]` (PLAT-5 plan 2.8). Local and ci only.
//   seed               writes the fixtures into the configured database (already migrated)
//   seed --template    rebuilds elx_seed from zero (migrate plus seed) for tools/stack.sh clone
import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { accountFixtures } from './fixtures.js';
import { buildSeedTemplate, seedFixtures, seedTemplateDatabase } from './seed.js';

const logger = new Logger('Seed');

async function main(): Promise<void> {
  const template = process.argv.slice(2).includes('--template');
  const config = loadConfig({ role: 'migrate' });
  if (config.app.env !== 'local' && config.app.env !== 'ci') {
    throw new Error('Seeds run only with APP_ENV=local or APP_ENV=ci');
  }
  if (template) {
    const version = await buildSeedTemplate(config);
    logger.log(`Built ${seedTemplateDatabase} at ${version} with the fixtures.`);
    return;
  }
  const inserted = await seedFixtures(config.db);
  logger.log(
    `Seeded ${inserted} of ${accountFixtures.length} fixture account(s); the rest existed.`,
  );
}

try {
  await main();
} catch (error) {
  logger.error(`Seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
