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
  // Computed and quoted forms: uow['tx'], ({ ['tx']: t }) and ({ 'tx': t }) (adversary re-check).
  { selector: "MemberExpression[computed=true][property.value='tx']", message: txMessage },
  { selector: "ObjectPattern > Property[key.value='tx']", message: txMessage },
];

/**
 * Adversary M-6 (A-17, doc 3 §9 "API input"): a controller takes its input only through
 * `@Input()`, which the kernel ContractPipe parses with the operation's generated strict schema.
 * Nest's raw parameter decorators would hand it unparsed input.
 */
const rawInputMessage =
  'Controllers take input only through @Input() with @Operation(operationSchemas.<id>) ' +
  '(ContractPipe, A-17); raw @Body/@Query/@Param/@Headers/@Req/@Request bypass the contract.';
export const rawInputRestrictions = [
  {
    selector: 'Decorator > CallExpression[callee.name=/^(Body|Query|Param|Headers|Req|Request)$/]',
    message: rawInputMessage,
  },
];

/** Where the raw-input rule applies; the violation fixture is linted only by its own test. */
const controllerFiles = [
  'src/**/*.controller.ts',
  'test/architecture/violations/lint/**/*.controller.ts',
];

export default defineConfig(
  { ignores: ['test/architecture/violations/lint/**'] },
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
    // The kernel's own controllers (none yet) may use the raw decorators for frame probes.
    files: controllerFiles,
    ignores: ['src/modules/kernel/**', 'src/**/*.repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...unitOfWorkTxRestrictions,
        ...rawInputRestrictions,
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
