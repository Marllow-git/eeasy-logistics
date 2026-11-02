import { censusConfig } from '@eeasy-logistics/config/census';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Sessions for the census (WEB-2 plan 2.14): the identities `pnpm --filter api seed:census` writes
// (apps/api/src/seed/census.ts; these values mirror it), sign-in through the app's own origin (the
// /v1 rewrite), the codes the stack's WhatsApp stub received and the links the stack's Mailpit
// holds. The census never reads the database: what it checks goes through the API and the browser.

export const origin = 'http://localhost:3001';

/** The census project of a test: one set of identities each, never shared. */
export type CensusProject = 'ar' | 'ar-390' | 'en';

/** Every census user's password (apps/api/src/seed/census.ts), assembled from parts. */
export const censusPassword = ['census', 'harbour', 'lantern', 'meadow'].join(' ');

export type CensusRole =
  | 'staff'
  | 'session'
  | 'owner'
  | 'factor'
  | 'enrol'
  | 'reset'
  | 'relink'
  | 'invitee'
  // WEB-3: the owner, a viewer and a site-scoped member of the project's own settings account.
  | 'settings'
  | 'viewer'
  | 'sitestaff';

export function censusEmail(role: CensusRole, project: CensusProject): string {
  return `census-${role}-${project.replace('-', '')}@census.test`;
}

const projectIndex = (project: CensusProject) => ['ar', 'ar-390', 'en'].indexOf(project) + 1;

/** 1: the enrolled factor phone, 2: the reset phone, 3: enrolment at sign-in, 4: after a reset. */
export function censusPhone(purpose: 1 | 2 | 3 | 4, project: CensusProject): string {
  return `+966570000${purpose}${String(projectIndex(project)).padStart(2, '0')}`;
}

export const censusAccountNames = { one: 'متجر الرياض', two: 'سوق جدة' } as const;

/** The settings account of each project (WEB-3), so the projects' writes never meet. */
export const censusSettingsAccounts = {
  ar: 'متجر الخبر',
  'ar-390': 'متجر الطائف',
  en: 'متجر أبها',
} as const satisfies Record<CensusProject, string>;

export function projectOf(name: string): CensusProject {
  if (name !== 'ar' && name !== 'ar-390' && name !== 'en') throw new Error(`project ${name}`);
  return name;
}

const stack = () => censusConfig();

/** The cookies of a `Set-Cookie` list as Playwright cookies on the app origin. */
function cookiesOf(setCookies: string[]) {
  return setCookies.map((line) => {
    const [pair = ''] = line.split(';');
    const separator = pair.indexOf('=');
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: origin,
      httpOnly: /;\s*httponly/i.test(line),
      secure: /;\s*secure/i.test(line),
      sameSite: 'Lax' as const,
    };
  });
}

/** Signs `role` in through the API on the app's origin and puts the session cookies in the context. */
export async function signIn(page: Page, role: CensusRole, project: CensusProject) {
  const response = await page.request.post('/v1/staff/auth/login', {
    headers: { 'X-EL-Client': 'web', Origin: origin },
    data: { email: censusEmail(role, project), password: censusPassword },
  });
  expect(response.status(), `login of ${role}`).toBe(200);
  const setCookies = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
  await page.context().addCookies(cookiesOf(setCookies));
}

export async function sessionCookie(context: BrowserContext, name: string) {
  return (await context.cookies(origin)).find((cookie) => cookie.name === name);
}

/** Replaces a session cookie's value in the browser, keeping it host-only with its attributes. */
export async function replaceCookie(context: BrowserContext, name: string, value: string) {
  await context.clearCookies({ name });
  await context.addCookies([
    { name, value, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

const base64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A copy of `token` with `exp` in the past. With the stack's signing key the copy is genuine
 * (the API answers `401 token_expired`); without it the signature is junk, which the proxy cannot
 * tell (it reads `exp` only) and the API refuses.
 */
export function expiredCopy(token: string, signingKey?: string): string {
  const [header = '', payload = ''] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const now = Math.floor(Date.now() / 1000);
  const body = `${header}.${base64Url({ ...claims, iat: now - 1200, exp: now - 300 })}`;
  const signature =
    signingKey === undefined
      ? Buffer.from('not the signature').toString('base64url')
      : createHmac('sha256', signingKey).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** The stack signing key for genuine expired tokens; the check that needs it fails without it. */
export function stackSigningKey(): string {
  const key = stack().signingKey;
  if (key === undefined) throw new Error('CENSUS_AUTH_SIGNING_KEY is needed for this check');
  return key;
}

/** The last code the WhatsApp stub sent to `phone`, newer than `previous`. */
export async function codeSentTo(phone: string, previous?: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${stack().whatsappStubUrl}/v1/last-code?to=${encodeURIComponent(phone)}`,
        );
        if (!response.ok) return undefined;
        const sent = (await response.json()) as { code?: string };
        code = sent.code !== previous ? sent.code : undefined;
        return code;
      },
      { timeout: 20_000, message: `a code for ${phone}` },
    )
    .toMatch(/^\d{6}$/);
  return code!;
}

/** The last code sent to `phone` now, if any (to tell a new one from it). */
export async function lastCode(phone: string): Promise<string | undefined> {
  const response = await fetch(
    `${stack().whatsappStubUrl}/v1/last-code?to=${encodeURIComponent(phone)}`,
  );
  if (!response.ok) return undefined;
  return ((await response.json()) as { code?: string }).code;
}

interface MailSummary {
  ID: string;
  Created: string;
}

/** The newest link to `path` in a mail to `email` (Mailpit), newer than `after`. */
export async function mailedLink(email: string, path: string, after?: Date): Promise<string> {
  const pattern = new RegExp(`${origin}/${path}/[A-Za-z0-9._~-]+`);
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${stack().mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        if (!search.ok) return undefined;
        const { messages } = (await search.json()) as { messages: MailSummary[] };
        for (const message of messages) {
          if (after !== undefined && new Date(message.Created) < after) continue;
          const full = await fetch(`${stack().mailpitUrl}/api/v1/message/${message.ID}`);
          const body = (await full.json()) as { Text?: string; HTML?: string };
          const found = pattern.exec(`${body.Text ?? ''} ${body.HTML ?? ''}`)?.[0];
          if (found !== undefined) {
            link = found;
            return link;
          }
        }
        return undefined;
      },
      { timeout: 20_000, message: `a ${path} mail to ${email}` },
    )
    .toBeDefined();
  return link!;
}
