// Entry point for the Playwright census of apps/web and apps/admin (WEB-2 plan 2.14): the stack
// services a census reads besides the app under test. A test tool, like `contract-test.ts`; the
// apps never import it. The defaults are the dev ports of `.env.example` (native stack, Compose
// `dev`); the CI lanes pass the ci profile's random ports.
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import { httpUrl } from './formats.ts';

export const censusVariables = {
  // Mailpit's HTTP API, where the census reads the invitation, reset and re-enrolment mails.
  CENSUS_MAILPIT_URL: httpUrl().default('http://127.0.0.1:8025'),
  // The WhatsApp stub, where the census reads the one-time codes (`/v1/last-code`).
  CENSUS_WHATSAPP_STUB_URL: httpUrl().default('http://127.0.0.1:8080'),
};

const expectations = {
  CENSUS_MAILPIT_URL: 'an http(s) URL of the stack Mailpit API',
  CENSUS_WHATSAPP_STUB_URL: 'an http(s) URL of the stack WhatsApp stub',
} satisfies Record<keyof typeof censusVariables, string>;

export interface CensusConfig {
  readonly mailpitUrl: string;
  readonly whatsappStubUrl: string;
}

/** Validates the census variables; throws `ConfigError` naming every invalid one. */
export function parseCensusConfig(env: EnvRecord): CensusConfig {
  const { values, issues } = parseVariables(censusVariables, expectations, env);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    mailpitUrl: new URL(values.CENSUS_MAILPIT_URL).origin,
    whatsappStubUrl: new URL(values.CENSUS_WHATSAPP_STUB_URL).origin,
  });
}

/** The census configuration from the process environment. */
export function censusConfig(): CensusConfig {
  return parseCensusConfig({
    CENSUS_MAILPIT_URL: process.env.CENSUS_MAILPIT_URL,
    CENSUS_WHATSAPP_STUB_URL: process.env.CENSUS_WHATSAPP_STUB_URL,
  });
}
