// Real staff sessions for the PLAT-12 HTTP suites (plan 2.14): the app as main.ts builds it, with a
// per-run rate-limit prefix, and members seeded as the owner (no policy applies) who then sign in
// through PLAT-11's `login` door, so every request carries the cookies a browser would.
import { randomBytes, randomInt } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import { PasswordHasher } from '../../src/modules/kernel/auth/passwords.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { webClientHeaders } from '../support/web-client.js';
import { cookieHeader, insertMembership, insertUser, setCookies } from './identity-fixtures.js';

export interface SignedInMember {
  readonly accountId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly email: string;
  /** The `Cookie` header of the session (access and refresh cookies). */
  readonly cookie: string;
}

export interface StaffApp {
  readonly app: NestExpressApplication;
  readonly http: () => ReturnType<typeof request>;
  /** A member of `accountId` with `roles` (and `siteIds`), signed in through `login`. */
  member(
    accountId: string,
    roles: readonly string[],
    options?: { siteIds?: readonly string[]; locale?: 'ar' | 'en' },
  ): Promise<SignedInMember>;
  /** Signs an existing user in again (a fresh session, or the login door's refusal). */
  login(email: string): Promise<request.Response>;
  /** The marker headers of a staff write (PLAT-6) from a fresh client address. */
  writeHeaders(): Record<string, string>;
  close(): Promise<void>;
}

/** A fresh documentation address per call (TEST-NET-2), so no login budget is shared. */
const address = () => `198.51.100.${randomInt(1, 255)}`;

/** What a suite adds to the app (PLAT-13): test-only controllers, provider overrides. */
export interface StaffAppOptions {
  readonly controllers?: Type[];
  readonly configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** `config` must carry the signing key, credentials and `TRUST_PROXY_HOPS: '1'`. */
export async function startStaffApp(
  config: Config,
  owner: postgres.Sql,
  options: StaffAppOptions = {},
): Promise<StaffApp> {
  const redisUrl = config.redis.url?.reveal();
  if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
  const runId = randomBytes(4).toString('hex');
  const redis = new Redis(redisUrl);
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(RATE_LIMITER)
    .useValue(new RateLimiter(redisRateLimitStore(redisUrl), { prefix: `elx-test-${runId}:rl` }));
  const moduleRef = await (options.configure?.(builder) ?? builder).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config), {
    ...httpAppOptions,
    logger: false,
  });
  configureHttp(app);
  await app.init();
  const password = `correct horse ${randomBytes(6).toString('hex')}`;
  const passwordHash = await app.get(PasswordHasher, { strict: false }).hash(password);
  const http = () => request(app.getHttpServer());
  const writeHeaders = () => ({
    ...webClientHeaders(config, 'staff'),
    'X-Forwarded-For': address(),
    'Accept-Language': 'en',
  });
  const login = (email: string) =>
    http().post('/v1/staff/auth/login').set(writeHeaders()).send({ email, password });

  return {
    app,
    http,
    writeHeaders,
    login,
    async member(accountId, roles, options = {}) {
      const user = await insertUser(owner, { passwordHash, locale: options.locale });
      const membershipId = await insertMembership(owner, accountId, user.id, {
        roles: [...roles],
        siteIds: [...(options.siteIds ?? [])],
      });
      const response = await login(user.email);
      if (response.status !== 200) {
        throw new Error(`login answered ${response.status}: ${JSON.stringify(response.body)}`);
      }
      const cookies = setCookies(response.headers);
      return {
        accountId,
        userId: user.id,
        membershipId,
        email: user.email,
        cookie: cookieHeader({
          el_staff_at: cookies.get('el_staff_at')?.value,
          el_staff_rt: cookies.get('el_staff_rt')?.value,
        }),
      };
    },
    async close() {
      await app.close();
      const left = await redis.keys(`elx-test-${runId}:*`);
      if (left.length > 0) await redis.del(...left);
      redis.disconnect();
    },
  };
}
