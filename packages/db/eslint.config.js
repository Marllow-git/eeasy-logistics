import { base, processRestrictions } from '@eeasy-logistics/config-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, {
  // The unit of work is the one place that sets elx.account_id (data §4.2; review M-5), so the
  // tenancy-setting restriction of the shared config is lifted here; the process rules stay.
  files: ['src/**/*.ts'],
  rules: { 'no-restricted-syntax': ['error', ...processRestrictions] },
});
