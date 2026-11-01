import { defineConfig } from 'eslint/config';
import { base, processRestrictions } from './index.js';

export default defineConfig(
  // The rule fixtures are inputs of test/, linted there by the rule under test, not by this config.
  { ignores: ['test/fixtures/**'] },
  base,
  {
    // index.js defines the tenancy-setting restriction, so it names the strings it forbids.
    files: ['index.js'],
    rules: { 'no-restricted-syntax': ['error', ...processRestrictions] },
  },
);
