import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { and, arrayContains, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import type { ChallengeKind } from '../schema/identity.js';
import { coreAuthChallenges } from '../schema/identity.js';

// core_auth_challenges on the platform pool (PLAT-11 plan 2.1, 2.3; A-26): the sign-in steps between
// the password and a session. A challenge is found by its id and the SHA-256 of its secret together,
// locked for the rest of the transaction, so two requests with one token cannot both consume it.

export interface NewChallenge {
  readonly id: string;
  readonly kind: ChallengeKind;
  readonly userId: string;
  readonly secretHash: Buffer;
  readonly amr: readonly string[];
  readonly membershipIds?: readonly string[] | null;
  readonly pendingPhone?: string | null;
  readonly ttlSeconds: number;
  readonly ip: string | null;
}

/** A challenge row as the doors need it; `expired` and `live` are on the database clock. */
export interface ChallengeRow {
  readonly id: string;
  readonly kind: ChallengeKind;
  readonly userId: string;
  readonly amr: readonly string[];
  readonly membershipIds: readonly string[] | null;
  readonly pendingPhone: string | null;
  /** A TOTP secret awaiting its first code (plan 2.9), encrypted under `pendingKeyId`. */
  readonly pendingSecretCiphertext: Buffer | null;
  readonly pendingKeyId: string | null;
  readonly attempts: number;
  readonly consumed: boolean;
  readonly expired: boolean;
  readonly expiresAt: Date;
}

export class AuthChallengesRepository extends PlatformRepository<typeof coreAuthChallenges> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAuthChallenges);
  }

  async insert(challenge: NewChallenge): Promise<Date> {
    const [row] = await this.unscoped()
      .insert(coreAuthChallenges)
      .values({
        id: challenge.id,
        kind: challenge.kind,
        userId: challenge.userId,
        secretHash: challenge.secretHash,
        amr: [...challenge.amr],
        membershipIds:
          challenge.membershipIds === undefined || challenge.membershipIds === null
            ? null
            : [...challenge.membershipIds],
        pendingPhone: challenge.pendingPhone ?? null,
        expiresAt: sql`now() + make_interval(secs => ${challenge.ttlSeconds})`,
        ip: challenge.ip,
      })
      .returning({ expiresAt: coreAuthChallenges.expiresAt });
    if (row === undefined) throw new Error('The challenge was not inserted');
    return row.expiresAt;
  }

  /**
   * The challenge of `kind` with this id and secret hash, locked `FOR UPDATE`, or undefined when
   * none matches (a wrong secret is indistinguishable from an unknown id).
   */
  async lock(
    id: string,
    secretHash: Buffer,
    kind: ChallengeKind | readonly ChallengeKind[],
  ): Promise<ChallengeRow | undefined> {
    const kinds: ChallengeKind[] = typeof kind === 'string' ? [kind] : [...kind];
    const [row] = await this.unscoped()
      .select({
        id: coreAuthChallenges.id,
        kind: coreAuthChallenges.kind,
        userId: coreAuthChallenges.userId,
        amr: coreAuthChallenges.amr,
        membershipIds: coreAuthChallenges.membershipIds,
        pendingPhone: coreAuthChallenges.pendingPhone,
        pendingSecretCiphertext: coreAuthChallenges.pendingSecretCiphertext,
        pendingKeyId: coreAuthChallenges.pendingKeyId,
        attempts: coreAuthChallenges.attempts,
        consumed: sql<boolean>`${coreAuthChallenges.consumedAt} IS NOT NULL`,
        expired: sql<boolean>`${coreAuthChallenges.expiresAt} <= now()`,
        expiresAt: coreAuthChallenges.expiresAt,
      })
      .from(coreAuthChallenges)
      .where(
        and(
          eq(coreAuthChallenges.id, id),
          eq(coreAuthChallenges.secretHash, secretHash),
          inArray(coreAuthChallenges.kind, kinds),
        ),
      )
      .for('update');
    return row;
  }

  async consume(id: string): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(coreAuthChallenges.id, id));
  }

  /** One more failed attempt (a wrong code); returns the new count. */
  async recordFailure(id: string): Promise<number> {
    const [row] = await this.unscoped()
      .update(coreAuthChallenges)
      .set({ attempts: sql`${coreAuthChallenges.attempts} + 1`, updatedAt: sql`now()` })
      .where(eq(coreAuthChallenges.id, id))
      .returning({ attempts: coreAuthChallenges.attempts });
    return row?.attempts ?? 0;
  }

  /** The phone an enrolment sends its code to, until confirmed (plan 2.8). */
  async setPendingPhone(id: string, phone: string): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ pendingPhone: phone, updatedAt: sql`now()` })
      .where(eq(coreAuthChallenges.id, id));
  }

  /** The TOTP secret an enrolment shows once, encrypted, until the first code confirms it (2.9). */
  async setPendingSecret(id: string, ciphertext: Buffer, keyId: string): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ pendingSecretCiphertext: ciphertext, pendingKeyId: keyId, updatedAt: sql`now()` })
      .where(eq(coreAuthChallenges.id, id));
  }

  /**
   * Redeems an emailed enrolment link (plan 2.8): the row takes a new secret (the link's own stops
   * working), the methods passed (`pwd`) and a fresh lifetime; returns the new expiry.
   */
  async redeem(
    id: string,
    secretHash: Buffer,
    amr: readonly string[],
    ttlSeconds: number,
  ): Promise<Date> {
    const [row] = await this.unscoped()
      .update(coreAuthChallenges)
      .set({
        secretHash,
        amr: [...amr],
        attempts: 0,
        expiresAt: sql`now() + make_interval(secs => ${ttlSeconds})`,
        updatedAt: sql`now()`,
      })
      .where(eq(coreAuthChallenges.id, id))
      .returning({ expiresAt: coreAuthChallenges.expiresAt });
    if (row === undefined) throw new Error('The challenge was not redeemed');
    return row.expiresAt;
  }

  /**
   * Consumes every open challenge of `kind` for the user whose `amr` holds `marker` (PLAT-13 M-2:
   * a new platform re-enrolment link replaces the earlier ones, never a staff link).
   */
  async consumeOpenMarked(userId: string, kind: ChallengeKind, marker: string): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreAuthChallenges.userId, userId),
          eq(coreAuthChallenges.kind, kind),
          isNull(coreAuthChallenges.consumedAt),
          arrayContains(coreAuthChallenges.amr, [marker]),
        ),
      );
  }

  /**
   * Consumes every open challenge of `kind` for the user whose `amr` lacks `marker` (PLAT-13
   * adversary round 2: a staff reset's new link replaces staff links, never the platform one).
   */
  async consumeOpenUnmarked(userId: string, kind: ChallengeKind, marker: string): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreAuthChallenges.userId, userId),
          eq(coreAuthChallenges.kind, kind),
          isNull(coreAuthChallenges.consumedAt),
          not(arrayContains(coreAuthChallenges.amr, [marker])),
        ),
      );
  }

  /** Consumes every open challenge of `kind` for the user (a new enrolment link replaces them). */
  async consumeOpen(userId: string, kind: ChallengeKind): Promise<void> {
    await this.unscoped()
      .update(coreAuthChallenges)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreAuthChallenges.userId, userId),
          eq(coreAuthChallenges.kind, kind),
          isNull(coreAuthChallenges.consumedAt),
        ),
      );
  }
}
