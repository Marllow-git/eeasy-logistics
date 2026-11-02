// Resolves the API origin of `test:contract` (PLAT-15 plan 2.8): `--api`, else `CONTRACT_API_URL`.
// Both go through the same rule of packages/config (an http(s) URL without a password).
import { parseArgs } from 'node:util';
import { ConfigError } from '@eeasy-logistics/config';
import { parseContractTestConfig } from '@eeasy-logistics/config/contract-test';

export type ApiUrlResult = { ok: true; apiUrl: string } | { ok: false; message: string };

/** `args` as the script receives them; `fromEnvironment` is `contractTestConfig` (lazily read). */
export function resolveApiUrl(
  args: string[],
  fromEnvironment: () => { apiUrl: string | undefined },
): ApiUrlResult {
  let flag: string | undefined;
  try {
    // pnpm forwards a literal `--` before the script's own arguments.
    const { values } = parseArgs({
      args: args.filter((arg) => arg !== '--'),
      options: originOptions,
    });
    flag = values.api;
  } catch (error) {
    return { ok: false, message: `test:contract: ${(error as Error).message}` };
  }
  if (flag !== undefined) {
    const invalid = {
      ok: false,
      message:
        '--api must be an absolute http(s) URL without a password, e.g. http://127.0.0.1:3000.',
    } as const;
    try {
      const { apiUrl } = parseContractTestConfig({ CONTRACT_API_URL: flag });
      return apiUrl === undefined ? invalid : { ok: true, apiUrl };
    } catch (error) {
      if (error instanceof ConfigError) return invalid;
      throw error;
    }
  }
  const { apiUrl } = fromEnvironment();
  if (apiUrl === undefined) {
    return {
      ok: false,
      message:
        'test:contract needs the API origin: pass --api http://127.0.0.1:3000 or set CONTRACT_API_URL.',
    };
  }
  return { ok: true, apiUrl };
}

const originOptions = {
  api: { type: 'string' },
  'web-origin': { type: 'string' },
  'admin-origin': { type: 'string' },
} as const;

/**
 * The `Origin` the browser surfaces send (PLAT-11 item I; ADR-0032, ADR-0038: the API refuses a
 * staff or platform write whose `Origin` is not its `PUBLIC_WEB_URL` or `PUBLIC_ADMIN_URL`):
 * `--web-origin` for staff, `--admin-origin` for platform; without them no `Origin` is sent and
 * those writes answer 403. Each must be an http(s) origin (scheme, host, port; no path).
 */
export type OriginsResult =
  { ok: true; origins: { staff?: string; platform?: string } } | { ok: false; message: string };

export function resolveOrigins(args: string[]): OriginsResult {
  let values: { 'web-origin'?: string; 'admin-origin'?: string };
  try {
    ({ values } = parseArgs({ args: args.filter((arg) => arg !== '--'), options: originOptions }));
  } catch (error) {
    return { ok: false, message: `test:contract: ${(error as Error).message}` };
  }
  const origins: { staff?: string; platform?: string } = {};
  for (const [flag, surface] of [
    ['web-origin', 'staff'],
    ['admin-origin', 'platform'],
  ] as const) {
    const value = values[flag];
    if (value === undefined) continue;
    let url: URL | undefined;
    try {
      url = new URL(value);
    } catch {
      url = undefined;
    }
    if (
      url === undefined ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== value.replace(/\/$/, '')
    ) {
      return {
        ok: false,
        message: `--${flag} must be an http(s) origin, e.g. http://localhost:3001.`,
      };
    }
    origins[surface] = url.origin;
  }
  return { ok: true, origins };
}
