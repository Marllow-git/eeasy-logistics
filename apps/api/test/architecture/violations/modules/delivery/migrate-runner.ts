// Violation: a context importing the elx_owner migration entry (rule db-migrate-only-in-owner-jobs).
import { runMigrations } from '@eeasy-logistics/db/migrate';

export const migrate = runMigrations;
