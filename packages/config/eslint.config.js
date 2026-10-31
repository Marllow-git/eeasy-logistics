import { base } from '@eeasy-logistics/config-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, {
  // The only files in the repository allowed to read the environment (README): the server entry
  // point and the two public entry points, which must spell `process.env.<NAME>` out for inlining.
  files: ['src/node.ts', 'src/web.ts', 'src/driver.ts'],
  rules: { 'no-restricted-properties': 'off' },
});
