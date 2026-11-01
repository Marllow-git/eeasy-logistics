// The single process entry point for server configuration (api and worker): the only file of the
// server side that reads `process.env` (see README). Everything it reads goes through
// `defineConfig()`; nothing else in a server process may read the environment.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { ConfigError, EX_CONFIG } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import type { Config, DefineConfigOptions } from './server.ts';
import { defineConfig } from './server.ts';

/**
 * The environment for `defineConfig()`. A `.env` file (gitignored; first found in `cwd`, then at the
 * workspace root) is read only when the process environment itself says `APP_ENV=local` (plan 2.7);
 * the file's own `APP_ENV` is ignored and variables already in the process environment win. In
 * every other case, `APP_ENV` unset included, the file is not read. `process.env` is never modified.
 */
export function readEnvironment(
  processEnv: EnvRecord = process.env,
  cwd: string = process.cwd(),
): EnvRecord {
  // The decision rests on the process environment alone: a `.env` file can never switch itself on,
  // and a file copied into an image or a server is ignored unless the process says `local`.
  if (processEnv.APP_ENV !== 'local') return { ...processEnv };
  const path = findEnvFile(cwd);
  if (path === undefined) return { ...processEnv };
  const file = dotenv.parse(readFileSync(path));
  // `APP_ENV` never comes from the file, so the file cannot turn a local process into anything else.
  delete file.APP_ENV;
  return { ...file, ...withoutEmpty(processEnv) };
}

/**
 * Reads and validates the configuration once at boot. On a `ConfigError` it prints the variable
 * names and problems (never a value) to stderr and exits with 78 (`EX_CONFIG`, plan 2.5).
 */
export function loadConfig(options: DefineConfigOptions = {}): Config {
  try {
    return defineConfig(readEnvironment(), options);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(EX_CONFIG);
    }
    throw error;
  }
}

function findEnvFile(cwd: string): string | undefined {
  const local = join(cwd, '.env');
  if (existsSync(local)) return local;
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const root = join(dir, '.env');
      return existsSync(root) ? root : undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function withoutEmpty(env: EnvRecord): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}
