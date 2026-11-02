// Real platform sessions for the PLAT-13 HTTP suites (plan 2.12): a staff member invited through
// PLAT-11's `Invitations.createPlatform`, who accepts, enrols TOTP and confirms through the doors,
// so every request carries the cookies the console would (`amr` pwd and totp).
import { randomBytes, randomInt } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { schemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type postgres from 'postgres';
import request from 'supertest';
import { Invitations } from '../../src/modules/kernel/auth/invitations.js';
import { fromBase32, totpAt } from '../../src/modules/kernel/auth/totp.js';
import { webClientHeaders } from '../support/web-client.js';
import { cookieHeader, freshEmail, setCookies } from './identity-fixtures.js';

export interface SignedInPlatformStaff {
  readonly userId: string;
  readonly email: string;
  readonly role: 'super_admin' | 'admin' | 'support';
  /** The `Cookie` header of the session (access and refresh cookies). */
  readonly cookie: string;
  /** The password the staff member accepted with (PLAT-13 leg 2: a later `platformLogin`). */
  readonly password: string;
}

/** The marker headers of a platform write (PLAT-6) from a fresh client address. */
export function platformWriteHeaders(config: Config): Record<string, string> {
  return {
    ...webClientHeaders(config, 'platform'),
    'X-Forwarded-For': `203.0.113.${randomInt(1, 255)}`,
    'Accept-Language': 'en',
  };
}

/** `config` must carry the signing key, credentials and `TRUST_PROXY_HOPS: '1'`. */
export async function platformStaff(
  app: NestExpressApplication,
  config: Config,
  owner: postgres.Sql,
  role: SignedInPlatformStaff['role'],
): Promise<SignedInPlatformStaff> {
  if (config.credentials === null) throw new Error('credentials keys are required');
  const http = () => request(app.getHttpServer());
  const write = (path: string) => http().post(path).set(platformWriteHeaders(config));
  const email = freshEmail(`platform-${role.replace('_', '-')}`);
  const created = await app.get(Invitations, { strict: false }).createPlatform({
    email,
    name: 'Platform Staff',
    role,
    invitedBy: null,
    locale: 'en',
  });
  const [mail] = await owner<{ payload: { params: { link: { encrypted: string } } } }[]>`
    SELECT payload FROM core_outbox
    WHERE kind = 'message' AND aggregate_id = ${created.invitationId}
      AND payload->>'template_key' = 'platform_invitation'`;
  if (mail === undefined) throw new Error('no platform invitation mail');
  const link = createCredentialsCipher(config.credentials).decrypt(
    Buffer.from(mail.payload.params.link.encrypted, 'base64'),
    `core_invitations:${created.invitationId}`,
  );
  const password = `staple battery ${randomBytes(6).toString('hex')}`;
  const accepted = await write('/v1/platform/auth/invitations/accept')
    .send({ token: link.split('/').at(-1), name: 'Platform Staff', password })
    .expect(200);
  const challenge = schemas.PlatformAcceptInvitation200Response.parse(accepted.body);
  const enrolment = await write('/v1/platform/auth/totp/enrol')
    .send({ challenge_id: challenge.challenge_id })
    .expect(200);
  const uri = new URL(String((enrolment.body as { otpauth_uri: string }).otpauth_uri));
  const secret = fromBase32(uri.searchParams.get('secret') ?? '');
  const confirmed = await write('/v1/platform/auth/totp/confirm')
    .send({
      challenge_id: challenge.challenge_id,
      code: totpAt(secret, Math.floor(Date.now() / 1000)),
    })
    .expect(200);
  const cookies = setCookies(confirmed.headers);
  return {
    userId: created.userId,
    email,
    role,
    password,
    cookie: cookieHeader({
      el_platform_at: cookies.get('el_platform_at')?.value,
      el_platform_rt: cookies.get('el_platform_rt')?.value,
    }),
  };
}
