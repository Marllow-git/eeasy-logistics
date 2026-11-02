import { base } from '@eeasy-logistics/config-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, {
  // The only files in the repository allowed to read the environment (README): the server entry
  // point, the two public entry points, which must spell `process.env.<NAME>` out for inlining, and
  // the contract-test runner's entry (PLAT-15), the web apps' server entry and the census entry
  // (WEB-2).
  files: [
    'src/node.ts',
    'src/web.ts',
    'src/web-server.ts',
    'src/driver.ts',
    'src/contract-test.ts',
    'src/census.ts',
  ],
  rules: { 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
});
