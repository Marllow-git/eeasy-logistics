// `pnpm --filter api seed:census` (WEB-2 plan 2.14): the web and console census identities in the
// configured database (already migrated). Local and ci only, checked before anything else is read
// (the seed writes known passwords and a known TOTP secret); needs DATABASE_URL_PLATFORM,
// CREDENTIALS_KEYS, PUBLIC_WEB_URL and PUBLIC_ADMIN_URL (the links in the mails), and a worker
// running to deliver the mails.
import { loadConfig, readEnvironment } from '@eeasy-logistics/config/node';
import { Logger } from '@nestjs/common';
import { censusSeedRefusal, seedCensus } from './census.js';

const refusal = censusSeedRefusal(readEnvironment().APP_ENV);
if (refusal !== undefined) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}

const logger = new Logger('SeedCensus');

async function main(): Promise<void> {
  const config = loadConfig({ role: 'api' });
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
