// Entry point for the Playwright census of apps/web and apps/admin (WEB-2 plan 2.14): the stack
// services a census reads besides the app under test. A test tool, like `contract-test.ts`; the
// apps never import it. The defaults are the dev ports of `.env.example` (native stack, Compose
// `dev`); the CI lanes pass the ci profile's random ports.
import { z } from 'zod';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import { httpUrl } from './formats.ts';

export const censusVariables = {
  // Mailpit's HTTP API, where the census reads the invitation, reset and re-enrolment mails.
  CENSUS_MAILPIT_URL: httpUrl().default('http://127.0.0.1:8025'),
  // The WhatsApp stub, where the census reads the one-time codes (`/v1/last-code`).
  CENSUS_WHATSAPP_STUB_URL: httpUrl().default('http://127.0.0.1:8080'),
  // The stack API's AUTH_SIGNING_KEY (a throwaway key of the census stack): the census re-signs a
  // session's access token with a past `exp` to get a genuine `401 token_expired` (plan 2.14).
  CENSUS_AUTH_SIGNING_KEY: z.string().min(32).optional(),
  // The stack API itself (WEB-4): the console census accepts a merchant owner's invitation on the
  // staff surface, which the admin app does not rewrite.
  CENSUS_API_URL: httpUrl().default('http://127.0.0.1:3000'),
};

const expectations = {
  CENSUS_MAILPIT_URL: 'an http(s) URL of the stack Mailpit API',
  CENSUS_WHATSAPP_STUB_URL: 'an http(s) URL of the stack WhatsApp stub',
  CENSUS_AUTH_SIGNING_KEY: 'the stack API signing key (AUTH_SIGNING_KEY), 32 characters or more',
  CENSUS_API_URL: 'an http(s) URL of the stack API',
} satisfies Record<keyof typeof censusVariables, string>;

export interface CensusConfig {
  readonly mailpitUrl: string;
  readonly whatsappStubUrl: string;
  readonly signingKey: string | undefined;
  readonly apiUrl: string;
}

/** Validates the census variables; throws `ConfigError` naming every invalid one. */
export function parseCensusConfig(env: EnvRecord): CensusConfig {
  const { values, issues } = parseVariables(censusVariables, expectations, env);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    mailpitUrl: new URL(values.CENSUS_MAILPIT_URL).origin,
    whatsappStubUrl: new URL(values.CENSUS_WHATSAPP_STUB_URL).origin,
    signingKey: values.CENSUS_AUTH_SIGNING_KEY,
    apiUrl: new URL(values.CENSUS_API_URL).origin,
  });
}

/** The census configuration from the process environment. */
export function censusConfig(): CensusConfig {
  return parseCensusConfig({
    CENSUS_MAILPIT_URL: process.env.CENSUS_MAILPIT_URL,
    CENSUS_WHATSAPP_STUB_URL: process.env.CENSUS_WHATSAPP_STUB_URL,
    CENSUS_AUTH_SIGNING_KEY: process.env.CENSUS_AUTH_SIGNING_KEY,
    CENSUS_API_URL: process.env.CENSUS_API_URL,
  });
}
