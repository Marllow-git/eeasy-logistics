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
      options: { api: { type: 'string' } },
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
