import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { and, eq, sql } from 'drizzle-orm';
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
    kind: ChallengeKind,
  ): Promise<ChallengeRow | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: coreAuthChallenges.id,
        kind: coreAuthChallenges.kind,
        userId: coreAuthChallenges.userId,
        amr: coreAuthChallenges.amr,
        membershipIds: coreAuthChallenges.membershipIds,
        pendingPhone: coreAuthChallenges.pendingPhone,
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
          eq(coreAuthChallenges.kind, kind),
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
}
