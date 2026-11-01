import {
  base,
  processRestrictions,
  tenancySettingRestrictions,
} from '@eeasy-logistics/config-eslint';
import { defineConfig } from 'eslint/config';

const txMessage =
  'Tenant code goes through a repository: only *.repository.ts files (and packages/db) may use a ' +
  "unit of work's raw transaction `tx` (data §4.2; PLAT-5 review M-1).";

/**
 * PLAT-5 review M-1: the raw Drizzle transaction of a unit of work skips the repository's account
 * predicate, so outside repository files neither `x.tx` nor a destructured `{ tx }` is allowed.
 */
const unitOfWorkTxRestrictions = [
  { selector: "MemberExpression[property.name='tx']", message: txMessage },
  { selector: "ObjectPattern > Property[key.name='tx']", message: txMessage },
];

export default defineConfig(
  base,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...unitOfWorkTxRestrictions,
      ],
    },
  },
  {
    // The database tests read the setting and drive raw transactions on purpose: they prove the
    // unit of work, the policies and the triggers. The process rules stay.
    files: ['test/integration/**/*.ts', 'test/schema/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...processRestrictions] },
  },
);
