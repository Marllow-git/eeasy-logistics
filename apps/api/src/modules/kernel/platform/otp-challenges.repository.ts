import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { OtpPurpose } from '../schema/otp-challenges.js';
import { coreOtpChallenges } from '../schema/otp-challenges.js';

// core_otp_challenges on the platform pool (PLAT-9 plan 2.4): the OTP doors are anonymous, so their
// one transaction is a platform unit of work with no account (data §2.4), in which the challenge
// and its `message` outbox row are written together.

/** The newest challenge of a phone and purpose, locked for the rest of the transaction. */
export interface LockedChallenge {
  readonly id: string;
  readonly codeHash: Buffer;
  readonly attempts: number;
  readonly consumed: boolean;
  /** `expires_at <= now()` on the database clock. */
  readonly expired: boolean;
}

export interface NewChallenge {
  readonly id: string;
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly codeHash: Buffer;
  readonly ttlSeconds: number;
  readonly ip: string | null;
}

export class OtpChallengesRepository extends PlatformRepository<typeof coreOtpChallenges> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreOtpChallenges);
  }

  /**
   * Serialises requests for one phone and purpose until the transaction ends (a transaction-level
   * advisory lock), so two concurrent requests cannot both pass the cooldown.
   */
  async lockPhone(phone: string, purpose: OtpPurpose): Promise<void> {
    await this.unscoped().execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`otp:${phone}:${purpose}`}, 0))`,
    );
  }

  /** Seconds left of the resend cooldown after the newest challenge, 0 when none is running. */
  async cooldownLeft(phone: string, purpose: OtpPurpose, cooldownSeconds: number): Promise<number> {
    const [row] = await this.unscoped()
      .select({
        left: sql<number>`ceil(extract(epoch from (${coreOtpChallenges.createdAt} + make_interval(secs => ${cooldownSeconds}) - now())))::int`,
      })
      .from(coreOtpChallenges)
      .where(and(eq(coreOtpChallenges.phone, phone), eq(coreOtpChallenges.purpose, purpose)))
      .orderBy(desc(coreOtpChallenges.createdAt))
      .limit(1);
    return Math.max(0, row?.left ?? 0);
  }

  async insert(challenge: NewChallenge): Promise<void> {
    await this.unscoped()
      .insert(coreOtpChallenges)
      .values({
        id: challenge.id,
        phone: challenge.phone,
        purpose: challenge.purpose,
        codeHash: challenge.codeHash,
        expiresAt: sql`now() + make_interval(secs => ${challenge.ttlSeconds})`,
        ip: challenge.ip,
      });
  }

  /**
   * The newest challenge of the phone and purpose, `FOR UPDATE`: a second verification of the same
   * challenge waits here until the first commits, then sees it consumed (identity and tenancy §3.2).
   * Only the newest counts, so a code superseded by a resend no longer verifies.
   */
  async lockNewest(phone: string, purpose: OtpPurpose): Promise<LockedChallenge | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: coreOtpChallenges.id,
        codeHash: coreOtpChallenges.codeHash,
        attempts: coreOtpChallenges.attempts,
        consumed: sql<boolean>`${coreOtpChallenges.consumedAt} IS NOT NULL`,
        expired: sql<boolean>`${coreOtpChallenges.expiresAt} <= now()`,
      })
      .from(coreOtpChallenges)
      .where(and(eq(coreOtpChallenges.phone, phone), eq(coreOtpChallenges.purpose, purpose)))
      .orderBy(desc(coreOtpChallenges.createdAt), desc(coreOtpChallenges.id))
      .limit(1)
      .for('update');
    return row;
  }

  async recordFailure(id: string): Promise<void> {
    await this.unscoped()
      .update(coreOtpChallenges)
      .set({ attempts: sql`${coreOtpChallenges.attempts} + 1`, updatedAt: sql`now()` })
      .where(eq(coreOtpChallenges.id, id));
  }

  async consume(id: string): Promise<void> {
    await this.unscoped()
      .update(coreOtpChallenges)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(coreOtpChallenges.id, id));
  }
}

/** The OTP doors' transaction: the repository and the unit of work the outbox writer needs. */
export interface OtpTransaction {
  readonly challenges: OtpChallengesRepository;
  readonly uow: PlatformUnitOfWork;
}

export interface OtpStore {
  run<T>(fn: (tx: OtpTransaction) => Promise<T>): Promise<T>;
}

/** One platform transaction per call, with no platform user (the doors are anonymous). */
export function otpStore(db: PlatformDatabase): OtpStore {
  return {
    run: (fn) =>
      withPlatformUnitOfWork(db, (uow) =>
        fn({ challenges: new OtpChallengesRepository(uow), uow }),
      ),
  };
}

/** The store on the API's platform pool, or null without one (`DATABASE_URL_PLATFORM` unset). */
export function otpStoreOnPool(pool: Pool<PlatformDatabase> | null): OtpStore | null {
  return pool === null ? null : otpStore(pool.db);
}
