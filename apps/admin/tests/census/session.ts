import { censusConfig } from '@eeasy-logistics/config/census';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';

// Console sessions for the census (WEB-2 plan 2.14, leg 2): the identities `pnpm --filter api
// seed:census` writes (apps/api/src/seed/census.ts; these values mirror it), sign-in through the
// console's own origin (the /v1/platform rewrite) with the TOTP codes computed here, and the links
// the stack's Mailpit holds. The census never reads the database.

export const origin = 'http://localhost:3002';

/** The census project of a test: one set of identities each, never shared. */
export type CensusProject = 'ar' | 'ar-390' | 'en';

export function projectOf(name: string): CensusProject {
  if (name !== 'ar' && name !== 'ar-390' && name !== 'en') throw new Error(`project ${name}`);
  return name;
}

/** Every census user's password (apps/api/src/seed/census.ts), assembled from parts. */
export const censusPassword = ['census', 'harbour', 'lantern', 'meadow'].join(' ');

/** The enrolled console staff's TOTP secret (base32; `censusTotpSecret` of the seed). */
export const censusTotpSecret = ['JBSWY3DP', 'EHPK3PXP', 'GEZDGNBV', 'GY3TQOJQ'].join('');

/**
 * The console roles of the seed, one per check, so no user signs in more than three times in a
 * run (a TOTP step is accepted once per user). `enrol` has no TOTP; `invitee` is invited by mail.
 */
export type PlatformRole =
  | 'admin'
  | 'enrol'
  | 'shell'
  | 'errors'
  | 'analytics'
  | 'session'
  | 'dialog'
  | 'logout'
  | 'invitee'
  // WEB-4: super admins for the accounts, lifecycle and rollout checks; an `admin` and a `support`.
  | 'accounts'
  | 'lifecycle'
  | 'rollout'
  | 'operator'
  | 'support';

export function platformEmail(role: PlatformRole, project: CensusProject): string {
  return `census-platform-${role}-${project.replace('-', '')}@census.test`;
}

// RFC 6238 over RFC 4226, the arithmetic of apps/api/src/modules/kernel/auth/totp.ts duplicated
// for the census (plan 2.14): HMAC-SHA-1 of the 8-byte step, dynamic truncation, six digits, a
// 30-second step from the epoch.

const stepSeconds = 30;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/\s+/g, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) throw new Error('Bad base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The TOTP step of now (or of `unixSeconds`). */
export function totpStep(unixSeconds = Date.now() / 1000): number {
  return Math.floor(unixSeconds / stepSeconds);
}

/** The six-digit code of `secret` (base32, spaces allowed) at `step`. */
export function totpCode(secret: string, step: number = totpStep()): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', fromBase32(secret)).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** A six-digit code that matches none of the steps the API accepts now (current ±1). */
export function wrongCode(secret: string): string {
  const step = totpStep();
  const accepted = new Set([-1, 0, 1].map((offset) => totpCode(secret, step + offset)));
  for (let candidate = 0; ; candidate++) {
    const code = String((Number(totpCode(secret, step)) + 1 + candidate) % 1_000_000).padStart(
      6,
      '0',
    );
    if (!accepted.has(code)) return code;
  }
}

const writeHeaders = { 'X-EL-Client': 'web', Origin: origin };

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

/**
 * Signs an enrolled console `role` in through the API on the console's origin (password, then the
 * TOTP code) and puts the session cookies in the context. The API accepts each step once per user
 * (the replay guard) within one step either side of now: the steps are tried oldest first, and
 * when all three are used the helper waits for the next one.
 */
export async function platformSignIn(page: Page, role: PlatformRole, project: CensusProject) {
  for (let round = 0; round < 3; round++) {
    const login = await page.request.post('/v1/platform/auth/login', {
      headers: writeHeaders,
      data: { email: platformEmail(role, project), password: censusPassword },
    });
    expect(login.status(), `platformLogin of ${role}`).toBe(200);
    const challenge = (await login.json()) as {
      challenge_id: string;
      totp_enrolment_required: boolean;
    };
    expect(challenge.totp_enrolment_required, `${role} has TOTP`).toBe(false);
    const step = totpStep();
    for (const offset of [-1, 0, 1]) {
      const verify = await page.request.post('/v1/platform/auth/totp/verify', {
        headers: writeHeaders,
        data: {
          challenge_id: challenge.challenge_id,
          code: totpCode(censusTotpSecret, step + offset),
        },
      });
      if (verify.status() === 200) {
        const setCookies = verify
          .headersArray()
          .filter((header) => header.name.toLowerCase() === 'set-cookie')
          .map((header) => header.value);
        await page.context().addCookies(cookiesOf(setCookies));
        return;
      }
      expect(verify.status(), `platformVerifyTotp of ${role}`).toBe(401);
    }
    // Every step of the window was used by this user already: wait for the next step.
    const wait = (stepSeconds - ((Date.now() / 1000) % stepSeconds)) * 1000 + 250;
    await page.waitForTimeout(wait);
  }
  throw new Error(`no TOTP step left for ${role}`);
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
 * A copy of `token` with `exp` in the past. With the stack's signing key the copy is genuine (the
 * API answers `401 token_expired`); without it the signature is junk, which the proxy cannot tell
 * (it reads `exp` only) and the API refuses.
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
  const key = censusConfig().signingKey;
  if (key === undefined) throw new Error('CENSUS_AUTH_SIGNING_KEY is needed for this check');
  return key;
}

interface MailSummary {
  ID: string;
  Created: string;
}

/** The newest link to `path` in a mail to `email` (Mailpit). */
export async function mailedLink(
  email: string,
  path: string,
  linkOrigin: string = origin,
): Promise<string> {
  const mailpit = censusConfig().mailpitUrl;
  const pattern = new RegExp(`${linkOrigin}/${path}/[A-Za-z0-9._~-]+`);
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        if (!search.ok) return undefined;
        const { messages } = (await search.json()) as { messages: MailSummary[] };
        for (const message of messages) {
          const full = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
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

// WEB-4: the console census accounts of apps/api/src/seed/census.ts (`censusConsoleAccounts`),
// mirrored here as the staff values are: ids from the seed's deterministic hash, the names.

function censusId(name: string): string {
  const hex = createHash('sha256').update(`census:${name}`).digest('hex');
  return `01920000-0000-7${hex.slice(0, 3)}-8${hex.slice(3, 6)}-${hex.slice(6, 18)}`;
}

const consoleNames = {
  ar: { active: 'متجر نجران', suspended: 'متجر حائل', provisioned: 'متجر القريات' },
  'ar-390': { active: 'متجر جازان', suspended: 'متجر الباحة', provisioned: 'متجر سكاكا' },
  en: { active: 'متجر تبوك', suspended: 'متجر عرعر', provisioned: 'متجر ينبع' },
} as const;

/** A project's console accounts: acted on (active), left suspended, left provisioned. */
export function consoleAccount(
  kind: 'active' | 'suspended' | 'provisioned',
  project: CensusProject,
): { id: string; name: string } {
  const prefix = kind === 'active' ? 'console' : kind;
  return {
    id: censusId(`account-${prefix}-${project.replace('-', '')}`),
    name: consoleNames[project][kind],
  };
}

/** The merchant web's origin (`PUBLIC_WEB_URL` of `.env.example`): a staff invitation's link. */
export const webOrigin = 'http://localhost:3001';

/**
 * Accepts a merchant owner's invitation as the owner would in apps/web (WEB-4 plan 2.13): the
 * token from the mail in Mailpit, `acceptInvitation` on the stack API with the web's Origin (the
 * console does not rewrite the staff surface).
 */
export async function acceptOwnerInvitation(email: string, name: string): Promise<void> {
  const link = await mailedLink(email, 'invitations', webOrigin);
  const token = link.slice(link.lastIndexOf('/') + 1);
  const answer = await fetch(`${censusConfig().apiUrl}/v1/staff/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EL-Client': 'web', Origin: webOrigin },
    body: JSON.stringify({ token, name, password: censusPassword }),
  });
  expect(answer.status, 'acceptInvitation of the provisioned owner').toBe(200);
}
