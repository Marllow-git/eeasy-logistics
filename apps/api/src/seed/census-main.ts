// `pnpm --filter api seed:census` (WEB-2 plan 2.14): the web census identities in the configured
// database (already migrated). Local and ci only; needs DATABASE_URL_PLATFORM, CREDENTIALS_KEYS and
// PUBLIC_WEB_URL (the links in the mails), and a worker running to deliver the mails.
import { loadConfig } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { seedCensus } from './census.js';

const logger = new Logger('SeedCensus');

async function main(): Promise<void> {
  const config = loadConfig({ role: 'api' });
  if (config.app.env !== 'local' && config.app.env !== 'ci') {
    throw new Error('seed:census runs only with APP_ENV=local or APP_ENV=ci');
  }
  const summary = await seedCensus(config);
  logger.log(
    `Census identities ready: ${summary.users} users, ${summary.invitations} invitations and ${summary.links} re-enrolment links mailed.`,
  );
}

try {
  await main();
} catch (error) {
  logger.error(`Census seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
