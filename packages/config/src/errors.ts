/** `EX_CONFIG` from sysexits.h: the process exit code for a configuration error. */
export const EX_CONFIG = 78;

/** One problem with one variable. `problem` is written by this package and never contains a value. */
export interface ConfigIssue {
  readonly variable: string;
  readonly problem: string;
}

/**
 * Every configuration problem found at once (plan 2.5). The message names each variable and what is
 * wrong with it; it never contains a value, so it is safe to print and to log.
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.problem}`);
    const count = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
    super(`Invalid configuration (${count}):\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}
