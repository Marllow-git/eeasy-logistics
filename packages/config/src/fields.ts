import type { z } from 'zod';
import type { ConfigIssue } from './errors.ts';

/** A schema per variable; the schema's output is the typed value (defaults included). */
export type VariableShape = Record<string, z.ZodType>;

/** What each variable must look like, in words; shown in errors instead of the received value. */
export type Expectations<Shape extends VariableShape> = { readonly [K in keyof Shape]: string };

export type ParsedVariables<Shape extends VariableShape> = {
  [K in keyof Shape]: z.output<Shape[K]>;
};

/** A plain record of environment variables, e.g. `process.env` handed over by an entry point. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * Parses each variable of `shape` from `env` on its own, so every invalid variable is reported, not
 * only the first. An empty string counts as unset. Problems are worded from `expectations` and the
 * package's own custom messages, never from the value or the schema library's default message
 * (which may quote the input).
 */
export function parseVariables<Shape extends VariableShape>(
  shape: Shape,
  expectations: Expectations<Shape>,
  env: EnvRecord,
): { values: ParsedVariables<Shape>; issues: ConfigIssue[] } {
  const values: Record<string, unknown> = {};
  const issues: ConfigIssue[] = [];
  for (const [variable, schema] of Object.entries(shape)) {
    const raw = Object.hasOwn(env, variable) ? env[variable] : undefined;
    const input = raw === '' ? undefined : raw;
    const result = schema.safeParse(input);
    if (result.success) {
      values[variable] = result.data;
      continue;
    }
    const expected = expectations[variable as keyof Shape];
    if (input === undefined) {
      issues.push({ variable, problem: `is required (${expected})` });
      continue;
    }
    // Custom issues carry messages written in this package (e.g. `credentialsKeys` in server.ts).
    const custom = result.error.issues
      .filter((issue) => issue.code === 'custom')
      .map((issue) => issue.message);
    issues.push({
      variable,
      problem:
        custom.length > 0 ? `is invalid: ${custom.join('; ')}` : `is invalid: expected ${expected}`,
    });
  }
  return { values: values as ParsedVariables<Shape>, issues };
}

/** Deep-freezes plain objects and arrays; class instances such as `Secret` are left as they are. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (Array.isArray(value) || proto === Object.prototype || proto === null) {
      for (const child of Object.values(value)) deepFreeze(child);
      Object.freeze(value);
    }
  }
  return value;
}
