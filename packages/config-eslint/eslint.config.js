import { defineConfig } from 'eslint/config';
import { base, processRestrictions } from './index.js';

export default defineConfig(base, {
  // index.js defines the tenancy-setting restriction, so it names the strings it forbids.
  files: ['index.js'],
  rules: { 'no-restricted-syntax': ['error', ...processRestrictions] },
});
