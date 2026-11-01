import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { coreAccounts } from '../schema/accounts.js';
import type { OptOutSource, SenderStatus } from '../schema/messaging.js';
import {
  coreEngineCallbackNonces,
  coreMessagingOptOuts,
  coreMessagingSenders,
  coreMessagingUsage,
} from '../schema/messaging.js';
import type { ProviderState } from '../schema/outbox.js';
import { coreOutbox } from '../schema/outbox.js';

// The messaging tables on the platform pool (PLAT-9 plan 2.5, 2.7, 2.8, 2A.2 to 2A.4): the worker's
// `message` handler and the engine callback door are cross-account system work, so they read and
// write through `unscoped()` with their own predicates, always naming the account explicitly.

/** An account's linked sender (plan 2A.4). */
export interface AccountSender {
  readonly senderInstanceId: string;
  readonly status: SenderStatus;
}

/** The account a linked instance belongs to, and that account's engine id (null if unallocated). */
export interface InstanceOwner {
  readonly accountId: string;
  readonly engineAccountId: number | null;
}

/** A `message` row as the callback door sees it. */
export interface MessageRowState {
  readonly accountId: string | null;
  readonly providerState: ProviderState | null;
  readonly providerUpdatedAt: Date | null;
}

export class MessagingRepository extends PlatformRepository<typeof coreMessagingSenders> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreMessagingSenders);
  }

  async senderOf(accountId: string): Promise<AccountSender | undefined> {
    const [row] = await this.unscoped()
      .select({
        senderInstanceId: coreMessagingSenders.senderInstanceId,
        status: coreMessagingSenders.status,
      })
      .from(coreMessagingSenders)
      .where(eq(coreMessagingSenders.accountId, accountId));
    return row;
  }

  async ownerOfInstance(senderInstanceId: string): Promise<InstanceOwner | undefined> {
    const [row] = await this.unscoped()
      .select({ accountId: coreAccounts.id, engineAccountId: coreAccounts.engineAccountId })
      .from(coreMessagingSenders)
      .innerJoin(coreAccounts, eq(coreAccounts.id, coreMessagingSenders.accountId))
      .where(eq(coreMessagingSenders.senderInstanceId, senderInstanceId));
    return row;
  }

  /**
   * The account's engine id (plan 2A.3), allocated from the sequence on first use. Concurrent first
   * uses both run the guarded UPDATE; one wins and the other reads the winner's value.
   */
  async engineAccountIdOf(accountId: string): Promise<number | undefined> {
    const [allocated] = await this.unscoped()
      .update(coreAccounts)
      .set({ engineAccountId: sql`nextval('core_accounts_engine_account_id_seq')` })
      .where(and(eq(coreAccounts.id, accountId), isNull(coreAccounts.engineAccountId)))
      .returning({ id: coreAccounts.engineAccountId });
    if (allocated?.id !== undefined && allocated.id !== null) return allocated.id;
    const [row] = await this.unscoped()
      .select({ id: coreAccounts.engineAccountId })
      .from(coreAccounts)
      .where(eq(coreAccounts.id, accountId));
    return row?.id ?? undefined;
  }

  /** Records a sender's connection state when it is newer than the stored one; true if applied. */
  async setSenderStatus(
    senderInstanceId: string,
    status: SenderStatus,
    occurredAt: Date,
  ): Promise<boolean> {
    const updated = await this.unscoped()
      .update(coreMessagingSenders)
      .set({ status, statusAt: occurredAt, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreMessagingSenders.senderInstanceId, senderInstanceId),
          sql`(${coreMessagingSenders.statusAt} IS NULL OR ${coreMessagingSenders.statusAt} < ${occurredAt.toISOString()}::timestamptz)`,
        ),
      )
      .returning({ id: coreMessagingSenders.accountId });
    return updated.length === 1;
  }

  // ---- opt-out list (integrations §5.5; plan 2.7) ----------------------------------------------

  async addOptOut(accountId: string, phone: string, source: OptOutSource): Promise<void> {
    await this.unscoped()
      .insert(coreMessagingOptOuts)
      .values({ accountId, phone, source })
      .onConflictDoNothing();
  }

  async removeOptOut(accountId: string, phone: string): Promise<void> {
    await this.unscoped()
      .delete(coreMessagingOptOuts)
      .where(
        and(eq(coreMessagingOptOuts.accountId, accountId), eq(coreMessagingOptOuts.phone, phone)),
      );
  }

  async isOptedOut(accountId: string, phone: string): Promise<boolean> {
    const rows = await this.unscoped()
      .select({ phone: coreMessagingOptOuts.phone })
      .from(coreMessagingOptOuts)
      .where(
        and(eq(coreMessagingOptOuts.accountId, accountId), eq(coreMessagingOptOuts.phone, phone)),
      );
    return rows.length === 1;
  }

  // ---- usage (integrations §5.6; plan 2.8) ------------------------------------------------------

  /** Adds one sent message to the account's current UTC month; returns the month's total. */
  async countSent(accountId: string): Promise<number> {
    const [row] = await this.unscoped()
      .insert(coreMessagingUsage)
      .values({
        accountId,
        period: sql`date_trunc('month', now() AT TIME ZONE 'UTC')::date`,
        sent: 1,
      })
      .onConflictDoUpdate({
        target: [coreMessagingUsage.accountId, coreMessagingUsage.period],
        set: { sent: sql`${coreMessagingUsage.sent} + 1`, updatedAt: sql`now()` },
      })
      .returning({ sent: coreMessagingUsage.sent });
    return row?.sent ?? 0;
  }

  /** Messages the account sent in the current UTC month. */
  async sentThisMonth(accountId: string): Promise<number> {
    const [row] = await this.unscoped()
      .select({ sent: coreMessagingUsage.sent })
      .from(coreMessagingUsage)
      .where(
        and(
          eq(coreMessagingUsage.accountId, accountId),
          eq(coreMessagingUsage.period, sql`date_trunc('month', now() AT TIME ZONE 'UTC')::date`),
        ),
      );
    return row?.sent ?? 0;
  }

  // ---- the engine callback door (plan 2A.2; engine contract §2.5) -------------------------------

  /** Reserves a nonce, atomically; false when it was seen before (a replay). */
  async reserveNonce(serviceIdentity: string, nonce: string): Promise<boolean> {
    const inserted = await this.unscoped()
      .insert(coreEngineCallbackNonces)
      .values({ serviceIdentity, nonce })
      .onConflictDoNothing()
      .returning({ nonce: coreEngineCallbackNonces.nonce });
    return inserted.length === 1;
  }

  /**
   * Marks the request's nonce row with the callback id; false when another request already carried
   * that id (a redelivered callback), which the caller acknowledges without applying it again. Runs
   * in the transaction that applies the callback, so a failed application releases the id.
   */
  async claimCallback(
    serviceIdentity: string,
    nonce: string,
    callbackId: string,
  ): Promise<boolean> {
    const claimed = await this.unscoped().execute(sql`
      UPDATE core_engine_callback_nonces SET callback_id = ${callbackId}
      WHERE service_identity = ${serviceIdentity} AND nonce = ${nonce}
        AND NOT EXISTS (SELECT 1 FROM core_engine_callback_nonces WHERE callback_id = ${callbackId})
      RETURNING nonce`);
    return claimed.length === 1;
  }

  /** A `message` row's account and provider state, locked for the update that follows. */
  async lockMessageRow(id: string): Promise<MessageRowState | undefined> {
    const [row] = await this.unscoped()
      .select({
        accountId: coreOutbox.accountId,
        providerState: coreOutbox.providerState,
        providerUpdatedAt: coreOutbox.providerUpdatedAt,
      })
      .from(coreOutbox)
      .where(and(eq(coreOutbox.id, id), eq(coreOutbox.kind, 'message')))
      .for('update');
    return row;
  }

  // ---- the OTP purge (plan 2.6; data §10) -------------------------------------------------------

  /**
   * Deletes `auth_otp` message rows an hour after they finished (`done_at`, else `created_at`),
   * OTP challenges an hour after `expires_at`, and callback nonces after 24 h.
   */
  async purgeOtpRows(): Promise<OtpPurgeCounts> {
    const db = this.unscoped();
    const messages = await db.execute(sql`
      DELETE FROM core_outbox
      WHERE kind = 'message'
        AND coalesce(payload ->> 'template_key', payload ->> 'template') = 'auth_otp'
        AND coalesce(done_at, created_at) < now() - interval '1 hour'
      RETURNING id`);
    const challenges = await db.execute(sql`
      DELETE FROM core_otp_challenges WHERE expires_at < now() - interval '1 hour' RETURNING id`);
    const nonces = await db.execute(sql`
      DELETE FROM core_engine_callback_nonces WHERE created_at < now() - interval '24 hours'
      RETURNING nonce`);
    return { messages: messages.length, challenges: challenges.length, nonces: nonces.length };
  }

  async setProviderState(id: string, state: ProviderState, at: Date): Promise<void> {
    await this.unscoped()
      .update(coreOutbox)
      .set({ providerState: state, providerUpdatedAt: at })
      .where(and(eq(coreOutbox.id, id), eq(coreOutbox.kind, 'message')));
  }
}

/** What one OTP purge deleted (plan 2.6). */
export interface OtpPurgeCounts {
  readonly messages: number;
  readonly challenges: number;
  readonly nonces: number;
}

/** One platform transaction with the messaging repository. */
export interface MessagingStore {
  run<T>(fn: (repo: MessagingRepository) => Promise<T>): Promise<T>;
}

export function messagingStore(db: PlatformDatabase): MessagingStore {
  return {
    run: (fn) => withPlatformUnitOfWork(db, (uow) => fn(new MessagingRepository(uow))),
  };
}
