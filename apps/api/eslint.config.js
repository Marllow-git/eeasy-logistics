import {
  base,
  processImportRestrictions,
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
 * Adversary M-6 (A-17, doc 3 §9 "API input"), completed after the re-check: a controller takes its
 * input only through `@Input()`, which the kernel ContractPipe parses with the operation's
 * generated strict schema. Nest's raw parameter decorators would hand it unparsed input, so:
 * importing them from `@nestjs/common` (named, aliased or through a namespace) is refused in
 * `src/`, the kernel included (a kernel use carries `eslint-disable-next-line ... -- <reason>`);
 * using one as a decorator in a controller is refused; and `@Controller()` appears only in
 * `*.controller.ts` files, where those rules apply.
 */
const rawInputMessage =
  'Controllers take input only through @Input() with @Operation(operationSchemas.<id>) ' +
  '(ContractPipe, A-17); raw parameter decorators bypass the contract.';
const rawDecorators = [
  'Body',
  'Query',
  'Param',
  'Headers',
  'Req',
  'Request',
  'Ip',
  'Session',
  'HostParam',
  'RawBody',
];
const decoratorPattern = `/^(${rawDecorators.join('|')})$/`;
export const rawInputRestrictions = [
  {
    selector: `Decorator > CallExpression[callee.name=${decoratorPattern}]`,
    message: rawInputMessage,
  },
  {
    selector: `Decorator > CallExpression[callee.property.name=${decoratorPattern}]`,
    message: rawInputMessage,
  },
];
const nestInputImports = {
  name: '@nestjs/common',
  importNames: [...rawDecorators, 'createParamDecorator'],
  message: rawInputMessage,
};

const controllerMessage =
  '@Controller() belongs in a *.controller.ts file, where the A-17 input rules apply (M-6).';
const controllerOutsideControllerFiles = [
  { selector: "Decorator > CallExpression[callee.name='Controller']", message: controllerMessage },
  {
    selector: "Decorator > CallExpression[callee.property.name='Controller']",
    message: controllerMessage,
  },
];

/**
 * Every `eslint-disable` comment states its reason after ` -- ` (re-check M-6: the kernel's uses
 * of the raw decorators are allowed one line at a time, each with its reason in the code).
 */
const elx = {
  rules: {
    'disable-needs-reason': {
      meta: {
        type: 'problem',
        messages: { reason: 'eslint-disable comments state their reason after " -- ".' },
        schema: [],
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const text = comment.value.trim();
              if (/^eslint-disable/.test(text) && !/\s--\s+\S/.test(text)) {
                context.report({ loc: comment.loc, messageId: 'reason' });
              }
            }
          },
        };
      },
    },
  },
};

/**
 * PLAT-7 (ADR-0031; adversary M-3, L-1): the elx_owner URL reaches application code only in the
 * migration job (src/migrate/, which also keeps the audit partitions) and the local seed tool.
 * Reading `config.db.urls.owner` anywhere else in src/ is refused, by dot, by computed name or by
 * destructuring.
 */
const ownerUrlMessage =
  'The elx_owner URL is for the migration job only (ADR-0031, PLAT-7 adversary M-3).';
const ownerUrlRestrictions = [
  {
    selector: "MemberExpression[property.name='owner'][object.property.name='urls']",
    message: ownerUrlMessage,
  },
  {
    selector: "MemberExpression[computed=true] > Literal[value='owner']",
    message: ownerUrlMessage,
  },
  { selector: "ObjectPattern > Property[key.name='owner']", message: ownerUrlMessage },
  { selector: "ObjectPattern > Property[key.value='owner']", message: ownerUrlMessage },
];
// The seed tool (local and ci only; staging and production refuse its admin URL) migrates too.
const ownerUrlJobs = ['src/migrate/**/*.ts', 'src/seed/**/*.ts'];

/** The violation fixtures of the lint rules, linted only by test/architecture-violations.test.ts. */
const lintFixtures = 'test/architecture/violations/lint';

export default defineConfig(
  { ignores: [`${lintFixtures}/**`] },
  base,
  {
    files: ['src/**/*.ts', `${lintFixtures}/**/*.ts`],
    plugins: { elx },
    rules: {
      'elx/disable-needs-reason': 'error',
      'no-restricted-imports': [
        'error',
        { paths: [...processImportRestrictions, nestInputImports] },
      ],
    },
  },
  {
    files: ['src/**/*.ts', `${lintFixtures}/**/*.ts`],
    ignores: ['**/*.repository.ts', '**/*.controller.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...unitOfWorkTxRestrictions,
        ...controllerOutsideControllerFiles,
        ...ownerUrlRestrictions,
      ],
    },
  },
  {
    // Repositories reach the transaction; they still never declare a controller.
    files: ['src/**/*.repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...controllerOutsideControllerFiles,
        ...ownerUrlRestrictions,
      ],
    },
  },
  {
    files: ['src/**/*.controller.ts', `${lintFixtures}/**/*.controller.ts`],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...unitOfWorkTxRestrictions,
        ...rawInputRestrictions,
        ...ownerUrlRestrictions,
      ],
    },
  },
  {
    // The two owner jobs: every rule of the general block but the owner URL one.
    files: ownerUrlJobs,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...processRestrictions,
        ...tenancySettingRestrictions,
        ...unitOfWorkTxRestrictions,
        ...controllerOutsideControllerFiles,
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
