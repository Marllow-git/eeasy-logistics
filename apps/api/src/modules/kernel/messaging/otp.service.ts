import type { CredentialsCipher } from '@eeasy-logistics/config';
import type { Locale } from '@eeasy-logistics/i18n/templates';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { OtpStore } from '../platform/otp-challenges.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import type { NamedBudgetName } from '../rate-limit/budgets.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import { getMetrics } from '../telemetry/metrics.js';
import type { OtpPurpose } from '../schema/otp-challenges.js';
import type { BreakerStateStore } from './breaker.js';
import type { MessageSenders } from './message-sender.js';
import { MessagingNotConfigured } from './message-sender.js';
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
  /** Live challenges a verification compares against (adversary M-2). */
  liveChallenges: 5,
} as const;

/** Whether an OTP can be sent now (integrations §2.4 "Breaker and degraded"). */
export class MessagingAvailability {
  readonly #logger = new Logger('Messaging');

  constructor(
    private readonly disabled: boolean,
    private readonly senders: Pick<MessageSenders, 'senderFor'>,
    private readonly breakers: BreakerStateStore | null,
  ) {}

  /**
   * True only when this build has a WhatsApp sender for the platform (review round 1, finding 2: a
   * configured provider without an adapter, or the stub without its URL, can never send), messaging
   * is not paused (`MESSAGING_DISABLED`), and that sender's breaker is closed (the shared state the
   * sending worker publishes). An unreadable breaker state counts as closed: the door fails open
   * like the rate limiter.
   */
  async whatsappAvailable(): Promise<boolean> {
    if (this.disabled) return false;
    let provider: string;
    try {
      provider = this.senders.senderFor(null, 'whatsapp').provider;
    } catch (error) {
      if (error instanceof MessagingNotConfigured) return false;
      throw error;
    }
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
  /**
   * False when the phone belongs to no one who may sign in with it (DEL-4 plan 2.7, identity §8):
   * every step runs (availability, the phone lock, the cooldown, the budgets, the challenge row)
   * except the `message` row, so the door answers and costs the same and no code is sent.
   * Default true.
   */
  readonly deliver?: boolean;
}

export interface OtpVerification {
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly code: string;
  /**
   * False: a right code proves possession without being spent (DEL-4 adversary H-2: the driver
   * still has to choose an account and sends the same code again). The match counts as one of the
   * challenge's five attempts, so a code answers at most five times. Default true.
   */
  readonly consume?: boolean;
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

/** A refused OTP request, by reason (`otp_requests_refused_total`; adversary M-1). */
function refused(reason: string): void {
  getMetrics().add('otp_requests_refused_total', 1, { reason });
}

/** Charges one named budget, counting a refusal under the budget's name. */
async function charged(
  limiter: Pick<RateLimiter, 'charge'> | undefined,
  name: NamedBudgetName,
  identity: string,
): Promise<void> {
  try {
    await limiter?.charge(name, identity);
  } catch (error) {
    if (error instanceof ApiException && error.code === 'rate_limited') refused(name);
    throw error;
  }
}
/** Compared when there is no challenge, so a miss costs the same HMACs as a wrong code. */
const absentChallenge = { id: '00000000-0000-7000-8000-000000000000', codeHash: Buffer.alloc(32) };

export class OtpService {
  readonly #deps: OtpServiceDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: OtpServiceDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('Otp');
  }

  /**
   * Sends a code: normalise the phone, refuse while messaging is unavailable, then in one platform
   * transaction (under the phone's lock) check the cooldown, charge the phone and address budgets,
   * write the challenge and its `message` outbox row (the code encrypted under
   * `core_otp_challenges:<id>`). A refusal for availability or the cooldown charges no budget, so
   * neither can spend a user's hourly quota (review round 1, finding 1). Resolves the same way
   * whether or not the phone belongs to anyone (identity and tenancy §8).
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
    if (!(await availability.whatsappAvailable())) {
      refused('unavailable');
      throw new ApiException('messaging_unavailable');
    }

    const code = generateOtpCode();
    const id = uuidv7();
    await store.run(async ({ challenges, uow }) => {
      await challenges.lockPhone(phone, input.purpose);
      const wait = await challenges.cooldownLeft(phone, input.purpose, otpRules.cooldownSeconds);
      if (wait > 0) {
        refused('cooldown');
        throw new ApiException('rate_limited', {
          details: { retry_after_s: wait },
          headers: { 'Retry-After': String(wait) },
        });
      }
      // The phone first: a phone out of budget never charges the address (review round 2,
      // finding 2). The Redis counters are not transactional with the insert below; a rolled-back
      // request keeps its charges (both budgets are protective and answer 429 either way).
      // Then the phone's day, the address, and the platform's hour (adversary M-1), each charged only
      // when every narrower one passed.
      const phoneRef = `phone:${hasher.phoneRef(phone)}`;
      await charged(limiter, 'otp_request_phone', phoneRef);
      await charged(limiter, 'otp_request_phone_day', phoneRef);
      await charged(limiter, 'otp_request_ip', `ip:${addressKey(input.ip)}`);
      await charged(limiter, 'otp_request_global', 'all');
      await challenges.insert({
        id,
        phone,
        purpose: input.purpose,
        codeHash: hasher.hash(id, code),
        ttlSeconds: otpRules.ttlSeconds,
        ip: input.ip === undefined || input.ip === '' ? null : input.ip,
      });
      const encrypted = cipher.encrypt(code, `core_otp_challenges:${id}`);
      if (input.deliver === false) return;
      await outbox.enqueue(uow, {
        type: 'core.otp_challenge.created',
        version: 1,
        aggregate: { type: 'otp_challenge', id, version: 1 },
        kind: 'message',
        supersedeKey: `otp:${phone}:${input.purpose}`,
        payload: {
          channel: 'whatsapp',
          template_key: 'auth_otp',
          to: phone,
          locale: input.locale,
          challenge_id: id,
          params: { code: { encrypted: encrypted.blob.toString('base64') } },
        },
      });
    });
    // The same line either way: the log does not tell whether the phone is anyone's.
    this.#logger.log(`otp challenge created purpose=${input.purpose} phone=${phoneTail(phone)}`);
  }

  /**
   * Checks a code against every live challenge of the phone and purpose (adversary M-2: a code stays
   * valid for its five minutes after a resend), at most five, newest first, under row locks. The
   * HMAC runs on five slots whatever the count (absent ones on a dummy), so the time does not tell
   * how many codes are live. A match consumes every live challenge; a wrong code adds one attempt to
   * each (five invalidate a challenge). Every failure, including an unparseable phone or no live
   * challenge, throws `401 otp_invalid` and nothing else. An unparseable phone is refused before any
   * transaction (review round 1, finding 3): its format is structural, not a secret to time.
   */
  async verify(input: OtpVerification): Promise<VerifiedPhone> {
    const { store, hasher } = this.#ready();
    const phone = normalisePhone(input.phone);
    if (phone === undefined) throw new ApiException('otp_invalid');
    const wellFormed = codePattern.test(input.code);
    const verified = await store.run(async ({ challenges }) => {
      const live = await challenges.lockLive(
        phone,
        input.purpose,
        otpRules.maxAttempts,
        otpRules.liveChallenges,
      );
      let matched = false;
      for (let slot = 0; slot < otpRules.liveChallenges; slot += 1) {
        const challenge = live[slot] ?? absentChallenge;
        const matches = hasher.matches(challenge.id, input.code, challenge.codeHash);
        if (matches && slot < live.length) matched = true;
      }
      const ids = live.map((challenge) => challenge.id);
      if (matched && wellFormed) {
        if (input.consume === false) await challenges.recordFailures(ids);
        else await challenges.consumeAll(ids);
        return true;
      }
      await challenges.recordFailures(ids);
      return false;
    });
    if (!verified) throw new ApiException('otp_invalid');
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
