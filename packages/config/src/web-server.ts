// Entry point for the server side of apps/web and apps/admin (WEB-2 plan 2.1, 2.13): the values
// their proxy, their server API client and `next.config.ts` read. Never imported by a client
// component: nothing here is `NEXT_PUBLIC_*`, so a browser bundle would see every value undefined.
// The variables keep the API's names where they mean the same thing (`PUBLIC_WEB_URL`,
// `PUBLIC_ADMIN_URL`), so one environment file serves the API and the web servers.
import { z } from 'zod';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import type { AppEnv } from './formats.ts';
import { appEnvs, httpUrl } from './formats.ts';

export const webServerVariables = {
  // The API on the internal network (platform §2): server components and the proxy's refresh call
  // it there; outside production `next.config.ts` also rewrites the browser's `/v1/<surface>/*` to
  // it (plan 2.1). Origin only.
  API_INTERNAL_URL: httpUrl().optional(),
  PUBLIC_WEB_URL: httpUrl().optional(),
  PUBLIC_ADMIN_URL: httpUrl().optional(),
};

const webServerExpectations = {
  API_INTERNAL_URL: 'an http(s) URL of the API on the internal network (origin only)',
  PUBLIC_WEB_URL: 'an http(s) URL',
  PUBLIC_ADMIN_URL: 'an http(s) URL',
} satisfies Record<keyof typeof webServerVariables, string>;

/** Which web application reads the values: each needs its own public URL. */
export type WebApp = 'web' | 'admin';

export interface WebServerConfig {
  /** `NEXT_PUBLIC_APP_ENV`, or undefined in a build that does not set it. */
  readonly appEnv: AppEnv | undefined;
  /** The API's internal origin, without a trailing slash. */
  readonly apiInternalUrl: string | undefined;
  /**
   * The origin of this application (`PUBLIC_WEB_URL` for apps/web, `PUBLIC_ADMIN_URL` for
   * apps/admin): the `Origin` the proxy's refresh call carries, which the API's web client marker
   * compares with its own copy of the same variable (ADR-0032, ADR-0038).
   */
  readonly publicOrigin: string | undefined;
}

const required: readonly AppEnv[] = ['staging', 'production'];

function originOf(url: string | undefined): string | undefined {
  return url === undefined ? undefined : new URL(url).origin;
}

/**
 * Validates the server values of `app`. `API_INTERNAL_URL` and the app's public URL are required in
 * staging and production; elsewhere they may be absent (a page that needs the API then fails with
 * the fetch error, and `next.config.ts` builds no rewrite).
 */
export function parseWebServerConfig(app: WebApp, env: EnvRecord): WebServerConfig {
  const appEnvValue = env.NEXT_PUBLIC_APP_ENV;
  const appEnv = z.enum(appEnvs).safeParse(appEnvValue === '' ? undefined : appEnvValue);
  const { values, issues } = parseVariables(webServerVariables, webServerExpectations, env);
  if (appEnvValue !== undefined && appEnvValue !== '' && !appEnv.success) {
    issues.push({
      variable: 'NEXT_PUBLIC_APP_ENV',
      problem: `is invalid: expected one of ${appEnvs.join(', ')}`,
    });
  }
  const resolvedEnv = appEnv.success ? appEnv.data : undefined;
  const publicVariable = app === 'web' ? 'PUBLIC_WEB_URL' : 'PUBLIC_ADMIN_URL';
  if (resolvedEnv !== undefined && required.includes(resolvedEnv)) {
    for (const variable of ['API_INTERNAL_URL', publicVariable] as const) {
      if (values[variable] === undefined && !issues.some((issue) => issue.variable === variable)) {
        issues.push({ variable, problem: `is required in ${resolvedEnv}` });
      }
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    appEnv: resolvedEnv,
    apiInternalUrl: originOf(values.API_INTERNAL_URL),
    publicOrigin: originOf(values[publicVariable]),
  });
}

const cached: Partial<Record<WebApp, WebServerConfig>> = {};

/** The validated server values of `app` from the process environment; throws `ConfigError`. */
export function webServerConfig(app: WebApp): WebServerConfig {
  cached[app] ??= parseWebServerConfig(app, {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    PUBLIC_WEB_URL: process.env.PUBLIC_WEB_URL,
    PUBLIC_ADMIN_URL: process.env.PUBLIC_ADMIN_URL,
  });
  return cached[app];
}
