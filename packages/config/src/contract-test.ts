// Entry point for the contract-test runner of packages/contracts (PLAT-15 plan 2.8): the only place
// that runner reads the environment. A test tool; the api, web and driver apps never import it.
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import { httpUrl } from './formats.ts';

export const contractTestVariables = {
  CONTRACT_API_URL: httpUrl().optional(),
};

const expectations = {
  CONTRACT_API_URL: 'an http(s) URL of the running API (origin only)',
} satisfies Record<keyof typeof contractTestVariables, string>;

export interface ContractTestConfig {
  /** The API under test; unset means the runner needs `--api`. */
  readonly apiUrl: string | undefined;
}

/** Validates the runner's variables; throws `ConfigError` naming every invalid one. */
export function parseContractTestConfig(env: EnvRecord): ContractTestConfig {
  const { values, issues } = parseVariables(contractTestVariables, expectations, env);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({ apiUrl: values.CONTRACT_API_URL });
}

/** The contract-test configuration from the process environment (`CONTRACT_API_URL` only). */
export function contractTestConfig(): ContractTestConfig {
  return parseContractTestConfig({ CONTRACT_API_URL: process.env.CONTRACT_API_URL });
}
