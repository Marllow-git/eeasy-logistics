import type { CredentialsCipher } from '@eeasy-logistics/config';
import type { Locale } from '@eeasy-logistics/i18n/templates';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { OtpStore } from '../platform/otp-challenges.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import type { OtpPurpose } from '../schema/otp-challenges.js';
import type { BreakerStateStore } from './breaker.js';
import type { OtpHasher } from './otp-code.js';
import { generateOtpCode } from './otp-code.js';
import { normalisePhone, phoneTail } from './phone.js';

// OTP challenges (PLAT-9 plan 2.4; identity and tenancy §3.2, §8; data §2.1, §10; integrations §2.4,
// §5.1). The sign-in doors of PLAT-11 call this service; it owns the rules every door shares:
// E.164 first, budgets per normalised phone and per address, the resend cooldown, the code never
// stored or logged in clear, single use under a row lock, five attempts, and one answer
// (`otp_invalid`) for every failed verification.

/** Identity and tenancy §3.2. */
export const otpRules = {
  ttlSeconds: 300,
  cooldownSeconds: 60,
  maxAttempts: 5,
} as const;

/** Whether an OTP can be sent now (integrations §2.4 "Breaker and degraded"). */
export class MessagingAvailability {
  readonly #logger = new Logger('Messaging');

  constructor(
    private readonly settings: { readonly disabled: boolean; readonly provider: string | null },
    private readonly breakers: BreakerStateStore | null,
  ) {}

  /**
   * False while messaging is paused (`MESSAGING_DISABLED`), when no provider is configured, or while
   * the provider's breaker is open (the shared state the sending worker publishes). An unreadable
   * breaker state counts as closed: the door fails open like the rate limiter.
   */
  async whatsappAvailable(): Promise<boolean> {
    const { disabled, provider } = this.settings;
    if (disabled || provider === null) return false;
    if (this.breakers === null) return true;
    try {
      return !(await this.breakers.isOpen(provider));
    } catch {
      this.#logger.warn('messaging breaker state unreadable: OTP requests are not held back');
      return true;
    }
  }
}

export interface OtpRequest {
  readonly phone: string;
  readonly purpose: OtpPurpose;
  /** The client address (`request.ip`), for the per-address budget and the row. */
  readonly ip: string | undefined;
  readonly locale: Locale;
}

export interface OtpVerification {
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly code: string;
}

/** What `verify` proves: the E.164 phone that received the code. */
export interface VerifiedPhone {
  readonly phone: string;
}

export interface OtpServiceDependencies {
  /** Null without `DATABASE_URL_PLATFORM`: every call answers 500. */
  readonly store: OtpStore | null;
  /** Null without credentials keys: every call answers 500 (production requires them). */
  readonly cipher: CredentialsCipher | null;
  readonly hasher: OtpHasher | null;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  /** Undefined without `REDIS_URL` (allowed outside production): no budget is charged. */
  readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
  readonly availability: Pick<MessagingAvailability, 'whatsappAvailable'>;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
}

const codePattern = /^[0-9]{6}$/;
/** Compared when there is no challenge, so a miss costs the same HMACs as a wrong code. */
const absentChallenge = { id: '00000000-0000-7000-8000-000000000000', hash: Buffer.alloc(32) };

export class OtpService {
  readonly #deps: OtpServiceDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: OtpServiceDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('Otp');
  }

  /**
   * Sends a code: normalise the phone, charge the address and phone budgets, refuse while messaging
   * is unavailable, then in one platform transaction check the cooldown, write the challenge and its
   * `message` outbox row (the code encrypted under `core_otp_challenges:<id>`). Resolves the same
   * way whether or not the phone belongs to anyone (identity and tenancy §8).
   */
  async request(input: OtpRequest): Promise<void> {
    const phone = normalisePhone(input.phone);
    if (phone === undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/phone', code: 'invalid' }],
      });
    }
    const { store, cipher, hasher } = this.#ready();
    const { limiter, availability, outbox } = this.#deps;
    await limiter?.charge('otp_request_ip', `ip:${addressKey(input.ip)}`);
    await limiter?.charge('otp_request_phone', `phone:${hasher.phoneRef(phone)}`);
    if (!(await availability.whatsappAvailable())) throw new ApiException('messaging_unavailable');

    const code = generateOtpCode();
    const id = uuidv7();
    await store.run(async ({ challenges, uow }) => {
      await challenges.lockPhone(phone, input.purpose);
      const wait = await challenges.cooldownLeft(phone, input.purpose, otpRules.cooldownSeconds);
      if (wait > 0) {
        throw new ApiException('rate_limited', {
          details: { retry_after_s: wait },
          headers: { 'Retry-After': String(wait) },
        });
      }
      await challenges.insert({
        id,
        phone,
        purpose: input.purpose,
        codeHash: hasher.hash(id, code),
        ttlSeconds: otpRules.ttlSeconds,
        ip: input.ip === undefined || input.ip === '' ? null : input.ip,
      });
      const encrypted = cipher.encrypt(code, `core_otp_challenges:${id}`);
      await outbox.enqueue(uow, {
        type: 'core.otp_challenge.created',
        version: 1,
        aggregate: { type: 'otp_challenge', id, version: 1 },
        kind: 'message',
        supersedeKey: `otp:${phone}:${input.purpose}`,
        payload: {
          channel: 'whatsapp',
          template: 'auth_otp',
          to: phone,
          locale: input.locale,
          challenge_id: id,
          params: { code: { encrypted: encrypted.blob.toString('base64') } },
        },
      });
    });
    this.#logger.log(`otp challenge created purpose=${input.purpose} phone=${phoneTail(phone)}`);
  }

  /**
   * Checks a code against the newest challenge of the phone and purpose, under a row lock: right,
   * unexpired, unconsumed and under five wrong attempts consumes it; a wrong code counts an
   * attempt. Every failure, including an unparseable phone or no challenge at all, throws
   * `401 otp_invalid` and nothing else.
   */
  async verify(input: OtpVerification): Promise<VerifiedPhone> {
    const { store, hasher } = this.#ready();
    const phone = normalisePhone(input.phone);
    const wellFormed = codePattern.test(input.code);
    const verified = await store.run(async ({ challenges }) => {
      if (phone === undefined) {
        hasher.matches(absentChallenge.id, input.code, absentChallenge.hash);
        return false;
      }
      const challenge = await challenges.lockNewest(phone, input.purpose);
      if (challenge === undefined) {
        hasher.matches(absentChallenge.id, input.code, absentChallenge.hash);
        return false;
      }
      const matches = hasher.matches(challenge.id, input.code, challenge.codeHash) && wellFormed;
      const usable =
        !challenge.consumed && !challenge.expired && challenge.attempts < otpRules.maxAttempts;
      if (!usable) return false;
      if (matches) {
        await challenges.consume(challenge.id);
        return true;
      }
      await challenges.recordFailure(challenge.id);
      return false;
    });
    if (!verified || phone === undefined) throw new ApiException('otp_invalid');
    return { phone };
  }

  #ready(): { store: OtpStore; cipher: CredentialsCipher; hasher: OtpHasher } {
    const { store, cipher, hasher } = this.#deps;
    if (store === null || cipher === null || hasher === null) {
      throw new ApiException('internal_error');
    }
    return { store, cipher, hasher };
  }
}
