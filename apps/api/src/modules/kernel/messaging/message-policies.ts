import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { MessagingRepository, MessagingStore } from '../platform/messaging.repository.js';

// The send-time policies of the `message` handler (PLAT-9 plan 2.5, 2.7, 2.8; integrations §4.3,
// §5.4, §5.5, §5.6; ADR-0037): staleness, quiet hours, the per-order and per-phone caps, opt-out and
// the monthly budget. OTP is exempt from all but staleness and `MESSAGING_DISABLED`: it is never
// delayed, capped, blocked by an opt-out or by the budget. Pure rules here; the handler applies them.

/** Integrations §4.3: an OTP row older than this is superseded (the code expires at 5 minutes). */
export const otpStaleAfterMs = 4 * 60 * 1000;

/** Integrations §5.4: at most 6 recipient messages per order, 10 per phone and account a day. */
export const messageCaps = { perOrder: 6, perPhonePerDay: 10 } as const;

/** Asia/Riyadh is UTC+3 all year (no daylight saving). */
const riyadhOffsetMs = 3 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
/** Quiet hours 22:00 to 08:00 Asia/Riyadh (integrations §5.4). */
const quietFromHour = 22;
const quietUntilHour = 8;

/**
 * Seconds until 08:00 Asia/Riyadh when `now` falls in the quiet hours (22:00 to 08:00), else 0.
 * Only templates flagged `deferrable` wait (none in wave 0); they then pass the staleness check.
 */
export function quietHoursWaitS(now: Date): number {
  const local = new Date(now.getTime() + riyadhOffsetMs);
  const hour = local.getUTCHours();
  if (hour >= quietUntilHour && hour < quietFromHour) return 0;
  const until = new Date(local);
  until.setUTCHours(quietUntilHour, 0, 0, 0);
  if (hour >= quietFromHour) until.setUTCDate(until.getUTCDate() + 1);
  return Math.ceil((until.getTime() - local.getTime()) / 1000);
}

/** The Asia/Riyadh calendar day of `now`, `YYYYMMDD`: the caps' daily window. */
export function riyadhDay(now: Date): string {
  return new Date(now.getTime() + riyadhOffsetMs).toISOString().slice(0, 10).replaceAll('-', '');
}

/** Whether an OTP row is too old to send (integrations §4.3). */
export function isStaleOtp(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > otpStaleAfterMs;
}

/** The daily counters of the caps (Redis, expiring after two days). */
export interface CapCounter {
  /** The current counts of the keys (0 when absent). */
  counts(keys: readonly string[]): Promise<number[]>;
  /** Adds one to each key. */
  hit(keys: readonly string[]): Promise<void>;
}

export const capKeyPrefix = 'elx:msgcap';

/** Counters in Redis under `<prefix>:<key>`, kept two days (the window is one Riyadh day). */
export function redisCapCounter(
  redis: Pick<Redis, 'mget' | 'multi'>,
  prefix: string = capKeyPrefix,
): CapCounter {
  return {
    async counts(keys) {
      if (keys.length === 0) return [];
      const values = await redis.mget(...keys.map((key) => `${prefix}:${key}`));
      return values.map((value) => Number(value ?? 0));
    },
    async hit(keys) {
      if (keys.length === 0) return;
      const tx = redis.multi();
      for (const key of keys) {
        tx.incr(`${prefix}:${key}`);
        tx.pexpire(`${prefix}:${key}`, 2 * 24 * hourMs);
      }
      await tx.exec();
    },
  };
}

/**
 * The cap keys of a recipient message: the order's (when the row names one) and the phone's per
 * account and day. The phone is a keyed pseudonym (HMAC under a key derived from the credentials
 * key), so Redis never holds a number (integrations §11).
 */
export function capKeys(
  pseudonymKey: Buffer,
  accountId: string,
  phone: string,
  orderId: string | undefined,
  now: Date,
): { order: string | undefined; phone: string } {
  const ref = createHmac('sha256', pseudonymKey)
    .update(`msgcap:${accountId}:${phone}`)
    .digest()
    .subarray(0, 16)
    .toString('hex');
  return {
    order: orderId === undefined ? undefined : `order:${orderId}`,
    phone: `phone:${accountId}:${ref}:${riyadhDay(now)}`,
  };
}

/** What a recipient message's policies read from the database (integrations §5.5, §5.6). */
export interface RecipientState {
  readonly optedOut: boolean;
  /** Messages the account sent this UTC month. */
  readonly sentThisMonth: number;
  /** The account's `messages_per_month`, or undefined while it has none (PLAT-13 sets it). */
  readonly limit: number | undefined;
}

/**
 * The opt-out list and the monthly usage of recipient messages, each call one platform transaction
 * (lead review round 2, finding 3): one read before the send, one count after it.
 */
export interface RecipientLedger {
  read(accountId: string, phone: string): Promise<RecipientState>;
  /** Counts one sent message; returns the month's total and the limit. */
  countSent(
    accountId: string,
  ): Promise<{ readonly sent: number; readonly limit: number | undefined }>;
}

/** The account's monthly limit, read in the ledger's transaction; none until PLAT-13. */
export type MonthlyLimit = (
  repo: MessagingRepository,
  accountId: string,
) => Promise<number | undefined>;

const noLimit: MonthlyLimit = () => Promise.resolve(undefined);

/** The ledger on the platform pool; `phone` is already E.164. */
export function recipientLedger(
  store: MessagingStore,
  limitOf: MonthlyLimit = noLimit,
): RecipientLedger {
  return {
    read: (accountId, phone) =>
      store.run(async (repo) => ({
        optedOut: await repo.isOptedOut(accountId, phone),
        sentThisMonth: await repo.sentThisMonth(accountId),
        limit: await limitOf(repo, accountId),
      })),
    countSent: (accountId) =>
      store.run(async (repo) => ({
        sent: await repo.countSent(accountId),
        limit: await limitOf(repo, accountId),
      })),
  };
}
